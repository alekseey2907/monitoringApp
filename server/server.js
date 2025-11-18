const net = require('net');
const dgram = require('dgram');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// Хранилище последних данных
let latestSensorData = {
  temp: null,
  ax: null, ay: null, az: null,
  gx: null, gy: null, gz: null,
  timestamp: null,
  connected: false
};

// История данных для графиков (храним последние 100 точек)
let dataHistory = [];
const MAX_HISTORY = 100;

// --- Автоматическое обнаружение ESP32 ---
let esp32IP = null;
let isScanning = false;

// Получение локальной подсети
function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Ищем IPv4, не loopback
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        const subnet = ip.substring(0, ip.lastIndexOf('.'));
        return subnet;
      }
    }
  }
  return null;
}

// Сканирование подсети для поиска ESP32
async function scanForESP32() {
  if (isScanning) return;
  isScanning = true;
  
  const subnet = getLocalSubnet();
  if (!subnet) {
    console.log('Cannot detect local network');
    isScanning = false;
    return;
  }

  console.log(`Scanning subnet ${subnet}.x for ESP32...`);

  // Пробуем подключиться к разным IP в подсети
  const promises = [];
  for (let i = 1; i <= 254; i++) {
    const testIP = `${subnet}.${i}`;
    promises.push(
      new Promise((resolve) => {
        const client = new net.Socket();
        client.setTimeout(500); // 500ms таймаут
        
        client.connect(12345, testIP, () => {
          console.log(`Found ESP32 at ${testIP}`);
          esp32IP = testIP;
          client.destroy();
          resolve(testIP);
        });
        
        client.on('error', () => {
          client.destroy();
          resolve(null);
        });
        
        client.on('timeout', () => {
          client.destroy();
          resolve(null);
        });
      })
    );
    
    // Сканируем партиями по 20, чтобы не перегружать систему
    if (i % 20 === 0) {
      await Promise.all(promises);
      promises.length = 0;
      if (esp32IP) break; // Если нашли, прекращаем сканирование
    }
  }
  
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  
  isScanning = false;
  
  if (!esp32IP) {
    console.log('ESP32 not found on network');
  }
}

// --- UDP для приема broadcast от ESP32 ---
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg, rinfo) => {
  const message = msg.toString();
  if (message.startsWith('ESP32_SENSOR:')) {
    const discoveredIP = message.split(':')[1].trim();
    if (!esp32IP) {
      esp32IP = discoveredIP;
      console.log(`ESP32 discovered via UDP: ${esp32IP}`);
      connectToESP32();
    }
  }
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP server listening on ${address.address}:${address.port}`);
});

udpServer.on('error', (err) => {
  console.log('UDP server error:', err.message);
});

try {
  udpServer.bind(45454);
} catch (err) {
  console.log('Failed to bind UDP port:', err.message);
}

// --- TCP подключение к ESP32 ---
let esp32Client = null;
let reconnectTimeout = null;
let discoveryAttempts = 0;

function connectToESP32() {
  if (!esp32IP) {
    discoveryAttempts++;
    console.log(`Discovery attempt ${discoveryAttempts}...`);
    
    // Каждые 3 попытки запускаем сканирование сети
    if (discoveryAttempts % 3 === 0) {
      console.log('Starting network scan...');
      scanForESP32().then(() => {
        if (esp32IP) {
          connectToESP32();
        }
      });
    }
    
    reconnectTimeout = setTimeout(connectToESP32, 3000);
    return;
  }

  console.log(`Connecting to ESP32: ${esp32IP}:12345`);
  
  esp32Client = new net.Socket();
  
  esp32Client.connect(12345, esp32IP, () => {
    console.log('Connected to ESP32');
    latestSensorData.connected = true;
    io.emit('esp32-status', { connected: true });
  });

  esp32Client.on('data', (data) => {
    const lines = data.toString().split('\n');
    
    lines.forEach(line => {
      if (line.trim().startsWith('{')) {
        try {
          const sensorData = JSON.parse(line.trim());
          
          // Обновляем данные
          latestSensorData = {
            ...sensorData,
            timestamp: Date.now(),
            connected: true
          };

          // Добавляем в историю
          dataHistory.push({
            ...sensorData,
            timestamp: Date.now()
          });

          // Ограничиваем размер истории
          if (dataHistory.length > MAX_HISTORY) {
            dataHistory.shift();
          }

          // Отправляем данные всем подключенным клиентам
          io.emit('sensor-data', latestSensorData);
          
          console.log(`Data: T=${sensorData.temp}°C, Accel=[${sensorData.ax},${sensorData.ay},${sensorData.az}]`);
        } catch (e) {
          console.error('JSON parse error:', e.message);
        }
      }
    });
  });

  esp32Client.on('error', (err) => {
    console.error('TCP error:', err.message);
    latestSensorData.connected = false;
    io.emit('esp32-status', { connected: false });
    
    // Если не можем подключиться, сбрасываем IP для повторного поиска
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
      console.log('ESP32 is unreachable, will search again');
      esp32IP = null;
      discoveryAttempts = 0;
    }
  });

  esp32Client.on('close', () => {
    console.log('ESP32 connection closed');
    latestSensorData.connected = false;
    io.emit('esp32-status', { connected: false });
    esp32Client = null;
    
    // Переподключение через 3 секунды
    reconnectTimeout = setTimeout(connectToESP32, 3000);
  });
}

// Запуск подключения к ESP32
connectToESP32();

// --- WebSocket для фронтенда ---
io.on('connection', (socket) => {
  console.log('Client connected to WebSocket');
  
  // Отправляем текущий статус подключения
  socket.emit('esp32-status', { connected: latestSensorData.connected });
  
  // Отправляем последние данные
  if (latestSensorData.timestamp) {
    socket.emit('sensor-data', latestSensorData);
  }
  
  // Отправляем историю данных
  socket.emit('data-history', dataHistory);

  socket.on('disconnect', () => {
    console.log('Client disconnected from WebSocket');
  });

  // Запрос истории данных
  socket.on('request-history', () => {
    socket.emit('data-history', dataHistory);
  });
});

// --- HTTP API (опционально) ---
app.get('/api/current', (req, res) => {
  res.json(latestSensorData);
});

app.get('/api/history', (req, res) => {
  res.json(dataHistory);
});

// Статические файлы (если нужно)
app.use(express.static('frontend'));

// Запуск HTTP сервера
const PORT = 3000;

function startServer() {
  const server = httpServer.listen(PORT, () => {
    console.log(`HTTP/WebSocket server running on port ${PORT}`);
  });

  return {
    close: () => {
      return new Promise((resolve) => {
        console.log('Stopping server...');
        
        // Останавливаем переподключение
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
        
        // Закрываем TCP клиент
        if (esp32Client) {
          esp32Client.destroy();
        }
        
        // Закрываем UDP сервер
        udpServer.close(() => {
          console.log('UDP server closed');
        });
        
        // Закрываем HTTP сервер
        server.close(() => {
          console.log('HTTP server closed');
          resolve();
        });
      });
    }
  };
}

module.exports = { startServer };
