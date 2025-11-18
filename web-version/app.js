// Подключение к WebSocket серверу
const socket = io('http://localhost:3000');

// Пороговые значения для алертов
const THRESHOLDS = {
  tempWarning: 60,    // °C
  tempDanger: 30,     // °C
  accelWarning: 15,   // м/с²
  accelDanger: 25,    // м/с²
  gyroWarning: 3,     // рад/с
  gyroDanger: 5       // рад/с
};

// Хранилище алертов
const alerts = [];
const MAX_ALERTS = 10;

// Инициализация графиков
let tempChart, accelChart, gyroChart, vibrationChart;

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    animation: false,
    scales: {
      x: {
        display: true,
        title: { display: true, text: 'Время' }
      },
      y: {
        display: true
      }
    },
    plugins: {
      legend: { display: true, position: 'top' }
    }
  };

  // График температуры
  const tempCtx = document.getElementById('tempChart').getContext('2d');
  tempChart = new Chart(tempCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Температура (°C)',
        data: [],
        borderColor: '#f56565',
        backgroundColor: 'rgba(245, 101, 101, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { title: { display: true, text: 'Температура (°C)' } }
      }
    }
  });

  // График ускорения
  const accelCtx = document.getElementById('accelChart').getContext('2d');
  accelChart = new Chart(accelCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'X',
          data: [],
          borderColor: '#f56565',
          backgroundColor: 'rgba(245, 101, 101, 0.1)',
          borderWidth: 2,
          tension: 0.4
        },
        {
          label: 'Y',
          data: [],
          borderColor: '#48bb78',
          backgroundColor: 'rgba(72, 187, 120, 0.1)',
          borderWidth: 2,
          tension: 0.4
        },
        {
          label: 'Z',
          data: [],
          borderColor: '#4299e1',
          backgroundColor: 'rgba(66, 153, 225, 0.1)',
          borderWidth: 2,
          tension: 0.4
        }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { title: { display: true, text: 'Ускорение (м/с²)' } }
      }
    }
  });

  // График гироскопа
  const gyroCtx = document.getElementById('gyroChart').getContext('2d');
  gyroChart = new Chart(gyroCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'X',
          data: [],
          borderColor: '#ed8936',
          backgroundColor: 'rgba(237, 137, 54, 0.1)',
          borderWidth: 2,
          tension: 0.4
        },
        {
          label: 'Y',
          data: [],
          borderColor: '#9f7aea',
          backgroundColor: 'rgba(159, 122, 234, 0.1)',
          borderWidth: 2,
          tension: 0.4
        },
        {
          label: 'Z',
          data: [],
          borderColor: '#38b2ac',
          backgroundColor: 'rgba(56, 178, 172, 0.1)',
          borderWidth: 2,
          tension: 0.4
        }
      ]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { title: { display: true, text: 'Угловая скорость (рад/с)' } }
      }
    }
  });

  // График вибрации (магнитуда ускорения)
  const vibrationCtx = document.getElementById('vibrationChart').getContext('2d');
  vibrationChart = new Chart(vibrationCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Вибрация (магнитуда)',
        data: [],
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { title: { display: true, text: 'Магнитуда (м/с²)' } }
      }
    }
  });
}

// Обновление графиков
function updateCharts(data) {
  const time = new Date(data.timestamp).toLocaleTimeString();

  // Ограничение количества точек на графике
  const maxPoints = 50;

  // Температура
  tempChart.data.labels.push(time);
  tempChart.data.datasets[0].data.push(data.temp);
  if (tempChart.data.labels.length > maxPoints) {
    tempChart.data.labels.shift();
    tempChart.data.datasets[0].data.shift();
  }
  tempChart.update();

  // Ускорение
  accelChart.data.labels.push(time);
  accelChart.data.datasets[0].data.push(data.ax);
  accelChart.data.datasets[1].data.push(data.ay);
  accelChart.data.datasets[2].data.push(data.az);
  if (accelChart.data.labels.length > maxPoints) {
    accelChart.data.labels.shift();
    accelChart.data.datasets.forEach(dataset => dataset.data.shift());
  }
  accelChart.update();

  // Гироскоп
  gyroChart.data.labels.push(time);
  gyroChart.data.datasets[0].data.push(data.gx);
  gyroChart.data.datasets[1].data.push(data.gy);
  gyroChart.data.datasets[2].data.push(data.gz);
  if (gyroChart.data.labels.length > maxPoints) {
    gyroChart.data.labels.shift();
    gyroChart.data.datasets.forEach(dataset => dataset.data.shift());
  }
  gyroChart.update();

  // Вибрация (магнитуда)
  const vibrationMag = Math.sqrt(data.ax ** 2 + data.ay ** 2 + data.az ** 2);
  vibrationChart.data.labels.push(time);
  vibrationChart.data.datasets[0].data.push(vibrationMag);
  if (vibrationChart.data.labels.length > maxPoints) {
    vibrationChart.data.labels.shift();
    vibrationChart.data.datasets[0].data.shift();
  }
  vibrationChart.update();
}

// Обновление текущих показаний
function updateCurrentReadings(data) {
  // Температура
  document.getElementById('temp-value').textContent = data.temp?.toFixed(1) || '--';
  
  // Проверка пороговых значений температуры
  const tempStatus = document.getElementById('temp-status');
  if (data.temp >= THRESHOLDS.tempDanger) {
    tempStatus.textContent = 'ОПАСНО!';
    tempStatus.className = 'status-danger';
    addAlert('danger', `Критическая температура: ${data.temp.toFixed(1)}°C`);
  } else if (data.temp >= THRESHOLDS.tempWarning) {
    tempStatus.textContent = 'Предупреждение';
    tempStatus.className = 'status-warning';
    addAlert('warning', `Повышенная температура: ${data.temp.toFixed(1)}°C`);
  } else {
    tempStatus.textContent = 'Норма';
    tempStatus.className = 'status-normal';
  }

  // Ускорение
  document.getElementById('ax-value').textContent = data.ax?.toFixed(2) || '--';
  document.getElementById('ay-value').textContent = data.ay?.toFixed(2) || '--';
  document.getElementById('az-value').textContent = data.az?.toFixed(2) || '--';
  
  const accelMag = Math.sqrt(data.ax ** 2 + data.ay ** 2 + data.az ** 2);
  document.getElementById('accel-mag').textContent = accelMag.toFixed(2);
  
  // Проверка вибрации
  if (accelMag >= THRESHOLDS.accelDanger) {
    addAlert('danger', `Критическая вибрация: ${accelMag.toFixed(2)} м/с²`);
  } else if (accelMag >= THRESHOLDS.accelWarning) {
    addAlert('warning', `Повышенная вибрация: ${accelMag.toFixed(2)} м/с²`);
  }

  // Гироскоп
  document.getElementById('gx-value').textContent = data.gx?.toFixed(2) || '--';
  document.getElementById('gy-value').textContent = data.gy?.toFixed(2) || '--';
  document.getElementById('gz-value').textContent = data.gz?.toFixed(2) || '--';
  
  const gyroMag = Math.sqrt(data.gx ** 2 + data.gy ** 2 + data.gz ** 2);
  document.getElementById('gyro-mag').textContent = gyroMag.toFixed(2);

  // Время последнего обновления
  document.getElementById('last-update').textContent = new Date(data.timestamp).toLocaleTimeString();
}

// Добавление алерта
function addAlert(type, message) {
  const timestamp = new Date().toLocaleTimeString();
  const alertText = `[${timestamp}] ${message}`;
  
  // Проверяем, не было ли такого же алерта недавно (предотвращение спама)
  const recentAlert = alerts.find(a => a.message === message && Date.now() - a.time < 5000);
  if (recentAlert) return;
  
  alerts.unshift({ type, message, time: Date.now() });
  
  if (alerts.length > MAX_ALERTS) {
    alerts.pop();
  }
  
  renderAlerts();
}

// Отрисовка алертов
function renderAlerts() {
  const container = document.getElementById('alerts-container');
  container.innerHTML = alerts.map(alert => 
    `<div class="alert-item ${alert.type}">${alert.message}</div>`
  ).join('');
}

// WebSocket события
socket.on('connect', () => {
  console.log('Подключено к серверу');
  addAlert('success', 'Подключено к серверу мониторинга');
});

socket.on('disconnect', () => {
  console.log('Отключено от сервера');
  addAlert('warning', 'Потеряно соединение с сервером');
});

socket.on('esp32-status', (status) => {
  const statusElement = document.getElementById('esp32-status');
  if (status.connected) {
    statusElement.textContent = 'Подключено';
    statusElement.className = 'status-indicator connected';
    addAlert('success', 'ESP32 подключен');
  } else {
    statusElement.textContent = 'Отключено';
    statusElement.className = 'status-indicator disconnected';
    addAlert('warning', 'ESP32 отключен');
  }
});

socket.on('sensor-data', (data) => {
  updateCurrentReadings(data);
  updateCharts(data);
});

socket.on('data-history', (history) => {
  console.log('Получена история данных:', history.length, 'точек');
  // Можно загрузить историю в графики при первом подключении
});

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  addAlert('info', 'Система мониторинга запущена');
});
