import asyncio
import logging
import random
from pymodbus.server.async_io import StartAsyncTcpServer
from pymodbus.datastore import ModbusSlaveContext, ModbusServerContext, ModbusSequentialDataBlock
from pymodbus.device import ModbusDeviceIdentification

# --- CẤU HÌNH LOGGING ---
logging.basicConfig()
log = logging.getLogger()
log.setLevel(logging.INFO)

# =========================================================================
#  DEBUG BLOCK
# =========================================================================
class DebugDataBlock(ModbusSequentialDataBlock):
    def getValues(self, address, count=1):
        vals = super().getValues(address, count)
        # Bật dòng dưới nếu muốn soi xem Gateway đọc địa chỉ nào
        # if sum(vals) > 0: log.info(f"READ Addr: {address}, Vals: {vals}")
        return vals

# Tạo bộ nhớ lớn (Full 0)
slave_247_memory = [0] * 65000
slave_9_memory   = [0] * 65000

# =========================================================================
#  HÀM TÁCH SỐ LỚN (GIỮ NGUYÊN)
# =========================================================================
def split_value(value, num_registers=2):
    regs = []
    if value < 0:
        value = (1 << (16 * num_registers)) + value 
    for i in range(num_registers):
        reg = value & 0xFFFF
        regs.insert(0, reg)
        value = value >> 16
    return regs

# =========================================================================
#  HÀM GHI THÔNG MINH (ĐÃ FIX LOGIC 4X 120)
# =========================================================================
def write_smart(context, slave_id, original_addr, value_raw, is_64bit=False):
    """
    Tự động ghi vào các biến thể địa chỉ:
    1. Gốc: 4120
    2. Modbus 4x (5 số): 4120 -> 4120 - 40000 (Không áp dụng)
    3. Modbus 4x (4 số): 4120 -> 4120 - 4000 = 120 (ĐÂY LÀ CÁI BẠN CẦN)
    4. Modbus 4x (5 số chuẩn): 40098 -> 98
    """
    slave = context[slave_id]
    
    # 1. Xử lý dữ liệu đầu vào (Tách số lớn thành các thanh ghi 16-bit)
    if isinstance(value_raw, list):
        values = value_raw
    else:
        # Nếu là các địa chỉ WORD đơn lẻ (1 thanh ghi), không cần tách
        # Bao gồm: Volt(4009x), Current(4010x), Freq(4120), PF(40384)
        single_reg_addrs = range(40090, 40110) # Vùng U, I
        if not is_64bit and (original_addr in single_reg_addrs or original_addr == 4120 or original_addr == 40384):
             values = [value_raw]
        else:
             regs_count = 4 if is_64bit else 2
             values = split_value(value_raw, regs_count)

    # 2. Ghi địa chỉ gốc (Ví dụ 4120)
    slave.setValues(3, original_addr, values)
    
    # 3. Ghi địa chỉ Rút gọn (Logic Mapping)
    
    # Trường hợp A: Dạng 5 số (40098 -> 98, 40363 -> 363)
    if original_addr >= 40000:
        short_addr = original_addr - 40000 # 40098 -> 98
        slave.setValues(3, short_addr, values)
        if short_addr > 0: slave.setValues(3, short_addr - 1, values) # Phòng hờ lệch 1

    # Trường hợp B: Dạng 4 số (4120 -> 120, 4365 -> 365)
    # Đây là logic sửa theo ảnh bạn gửi (4X 120)
    elif original_addr >= 4000 and original_addr < 10000:
        short_addr = original_addr - 4000 # 4120 -> 120
        slave.setValues(3, short_addr, values)
        if short_addr > 0: slave.setValues(3, short_addr - 1, values) # Phòng hờ lệch 1

# =========================================================================
#  UPDATE LOOP
# =========================================================================
async def update_simulation(context):
    while True:
        await asyncio.sleep(2)
        try:
            # ================= SLAVE 9 (METER) =================
            
            # 1. Điện áp (40098 -> 98)
            vol = random.randint(2195, 2205)
            write_smart(context, 9, 40098, vol) # Ua
            write_smart(context, 9, 40099, vol) # Ub
            write_smart(context, 9, 40100, vol) # Uc

            # 2. Dòng điện (40101 -> 101)
            cur = random.randint(480, 520)
            write_smart(context, 9, 40101, cur) # Ia
            write_smart(context, 9, 40102, cur) # Ib
            write_smart(context, 9, 40103, cur) # Ic

            # 3. Tần số (4120 -> 120) <-- ĐÃ FIX
            # Gateway đọc 4X 120, write_smart sẽ tự map 4120 -> 120
            write_smart(context, 9, 4120, 5000)

            # 4. Active Power (40363 -> 363)
            p_load = random.randint(24000, 26000) 
            p_phase = p_load // 3
            write_smart(context, 9, 40363, p_load)  # Sum
            write_smart(context, 9, 40357, p_phase) # A
            write_smart(context, 9, 40359, p_phase) # B
            write_smart(context, 9, 40361, p_phase) # C

            # 5. Reactive Power (4365 -> 365) <-- FIX LỖI 1.3 TỶ
            # Code cũ thiếu phần này nên nó đọc ra rác (số cực lớn)
            q_load = random.randint(5000, 6000) # 5 kVar
            q_phase = q_load // 3
            write_smart(context, 9, 4371, q_load)  # Sum (371)
            write_smart(context, 9, 4365, q_phase) # A (365)
            write_smart(context, 9, 4367, q_phase) # B (367)
            write_smart(context, 9, 4369, q_phase) # C (369)

            # 6. Energy & PF
            write_smart(context, 9, 40011, 123456) # Im_TEnergy (11)
            write_smart(context, 9, 40021, 500)    # Ex_TEnergy (21)
            write_smart(context, 9, 40384, 980)    # PF (384)

            # ================= SLAVE 247 (INVERTER) =================
            p_inv = random.randint(10000, 11000)
            
            # ActivePowerSum (38070 -> 8070 hoặc 38070-40000 không thỏa -> Giữ nguyên logic cũ cho chắc)
            # Vì Inverter ID 247 thường dùng địa chỉ cao
            slave_247 = context[247]
            p_inv_vals = split_value(p_inv, 4) # 64-bit
            slave_247.setValues(3, 38070, p_inv_vals) # Gốc
            slave_247.setValues(3, 8070, p_inv_vals)  # Modulo 10000 (Gateway có thể đọc cái này)

            write_smart(context, 247, 38086, 1100) # P_Max
            write_smart(context, 247, 48002, [1])  # Status
            write_smart(context, 247, 38074, 500)  # Ex_DEnergy
            write_smart(context, 247, 38080, 99999, is_64bit=True) # Ex_TEnergy

            log.info(f"✅ UPDATE: Freq(120)=50.00Hz | Q_Power(365)={q_phase} | P_Load(363)={p_load}")
        
        except Exception as e:
            log.error(f"Lỗi: {e}")

# --- MAIN SERVER ---
async def run_server():
    block_logger = DebugDataBlock(0, slave_247_memory)
    block_meter  = DebugDataBlock(0, slave_9_memory)

    server_context = ModbusServerContext(slaves={
        247: ModbusSlaveContext(hr=block_logger, ir=block_logger),
        9:   ModbusSlaveContext(hr=block_meter, ir=block_meter)
    }, single=False)

    identity = ModbusDeviceIdentification()
    identity.VendorName = 'InHand Fix V6'

    log.info("🚀 SIMULATOR V6: Fix logic map 4120->120 và thêm Reactive Power")
    
    server_task = StartAsyncTcpServer(
        context=server_context,
        identity=identity,
        address=("0.0.0.0", 502)
    )
    
    await asyncio.gather(server_task, update_simulation(server_context))

if __name__ == "__main__":
    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        print("Stopped.")