@echo off
REM --- CONFIGURATION ---
SET TOOLCHAIN_PREFIX=arm-linux-gnueabihf-
SET SYSROOT_PATH=C:\IG502_sysroot
SET PYTHON_VERSION=3.7

REM --- SET ENVIRONMENT VARIABLES FOR CROSS-COMPILATION ---
echo "Setting up environment for ARM cross-compilation..."
    
REM Dọn dẹp các biến có thể gây xung đột từ môi trường Windows
SET VSINSTALLDIR=
SET VCINSTALLDIR=
SET "Path=%PATH:Microsoft Visual Studio=%"

REM Thiết lập cross-compiler
SET CC=%TOOLCHAIN_PREFIX%gcc -fPIC
SET CXX=%TOOLCHAIN_PREFIX%g++ -fPIC
SET LDSHARED=%TOOLCHAIN_PREFIX%gcc -shared
SET AR=%TOOLCHAIN_PREFIX%ar
SET RANLIB=%TOOLCHAIN_PREFIX%ranlib
    
REM Flags cho trình biên dịch và trình liên kết
SET CFLAGS=--sysroot=%SYSROOT_PATH% -I%SYSROOT_PATH%/usr/include/python%PYTHON_VERSION%
SET LDFLAGS=--sysroot=%SYSROOT_PATH% -L%SYSROOT_PATH%/usr/lib -L%SYSROOT_PATH%/lib -lpython%PYTHON_VERSION%m

REM Ghi đè cấu hình distutils để sử dụng cross-compiler
SET _PYTHON_SYSCONFIGDATA_NAME=_sysconfigdata_m_linux_arm-linux-gnueabihf
    
echo "CC       = %CC%"
echo "LDSHARED = %LDSHARED%"
echo "CFLAGS   = %CFLAGS%"
echo "LDFLAGS  = %LDFLAGS%"
echo "----------------------------------------------------"
    
REM --- RUN THE BUILD COMMAND ---
echo "Starting Python build..."
REM *** THAY ĐỔI QUAN TRỌNG: Thêm cờ --compiler=mingw32 để ép buộc ***
python setup1.py build_ext --compiler=mingw32 --force

echo "Build finished."
pause