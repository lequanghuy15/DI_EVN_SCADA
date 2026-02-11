# --- START OF FILE app_instance.py ---

import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from constants import STATIC_FOLDER_PATH

# Khởi tạo các đối tượng ứng dụng và socketio ở đây
app = Flask(__name__, static_folder=STATIC_FOLDER_PATH, static_url_path='')
app.config['SECRET_KEY'] = 'a_very_secret_key_for_flask_socketio_please_change_me'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')