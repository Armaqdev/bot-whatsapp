const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const { getBotStatus, getLastQrDataUrl } = require('./state');

// FIX: la carpeta public está al mismo nivel que server.js, no un nivel arriba
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());

app.get('/api/status', (req, res) => {
    res.json(getBotStatus());
});

app.get('/api/qr', (req, res) => {
    const qr = getLastQrDataUrl();
    if (qr) {
        res.json({ qr });
    } else {
        res.json({ qr: null, message: 'QR no disponible aún.' });
    }
});

app.post('/api/config', (req, res) => {
    const { apiKey } = req.body;
    // Aquí deberías guardar la configuración en un archivo .env o variable de entorno
    res.send('Configuración guardada (simulado)');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor web iniciado en http://localhost:${PORT}`);
});