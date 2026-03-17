

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Estado y QR compartidos
const { getBotStatus, getLastQrDataUrl } = require('./state');

// Servir archivos estáticos de la carpeta public
app.use(express.static(path.join(__dirname, '../public')));

// Middleware para parsear JSON
app.use(express.json());

// Endpoint para consultar el estado del bot
app.get('/api/status', (req, res) => {
  res.json(getBotStatus());
});

// Endpoint para obtener el QR real
app.get('/api/qr', (req, res) => {
  const qr = getLastQrDataUrl();
  if (qr) {
    res.json({ qr });
  } else {
    res.json({ qr: null, message: 'QR no disponible aún.' });
  }
});

// Endpoint para guardar configuraciones (ejemplo: API Key)
app.post('/api/config', (req, res) => {
  const { apiKey } = req.body;
  // Aquí deberías guardar la configuración en un archivo o variable
  // Por ahora, solo respondemos OK
  res.send('Configuración guardada (simulado)');
});

// Endpoint raíz: servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor web iniciado en http://localhost:${PORT}`);
});