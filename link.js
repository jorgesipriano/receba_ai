import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal'; // 👈 1. Importa a nova ferramenta

const DATA_PATH = process.env.DATA_PATH || '.';
const SESSION_DIR = `${DATA_PATH}/auth_barpay`;

async function connectToWhatsApp() {
    console.log('Iniciando conexão para gerar QR Code...');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
        auth: state
        // 👈 2. Removemos a opção 'printQRInTerminal: true' daqui
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // 👈 3. Esta é a nova lógica para mostrar o QR Code
        if (qr) {
            console.log('------------------------------------------------');
            console.log('Escaneie o QR Code abaixo com seu WhatsApp:');
            qrcode.generate(qr, { small: true }); // Desenha o QR Code no terminal
            console.log('------------------------------------------------');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada por motivo:', lastDisconnect.error, ', reconectando:', shouldReconnect);
            if (!shouldReconnect) {
                console.log('Desconectado permanentemente. Apague a pasta auth_barpay e rode o link.js novamente se precisar.');
            }
        } else if (connection === 'open') {
            console.log('\n✅ Conexão aberta e sessão salva com sucesso!');
            console.log('Pode fechar este processo (Ctrl+C) e iniciar o bot principal com "pm2 start barpay-app".');
        }
    });
}

connectToWhatsApp().catch(err => console.log("Erro inesperado: " + err));
