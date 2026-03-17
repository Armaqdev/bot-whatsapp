// src/state.js
// Estado compartido entre el bot y el servidor web

let botStatus = {
  available: false,
  message: 'Bot no iniciado'
};
let lastQrDataUrl = null;

function setBotStatus(status) {
  botStatus = { ...botStatus, ...status };
}
function getBotStatus() {
  return botStatus;
}
function setLastQrDataUrl(dataUrl) {
  lastQrDataUrl = dataUrl;
}
function getLastQrDataUrl() {
  return lastQrDataUrl;
}

module.exports = {
  setBotStatus,
  getBotStatus,
  setLastQrDataUrl,
  getLastQrDataUrl
};
