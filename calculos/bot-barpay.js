// --- Importações ---
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import 'dotenv/config'; // Carrega as variáveis de ambiente
import db from './database.js';

// --- Configurações Gerais ---
const DATA_PATH = process.env.DATA_PATH || '.';
const SESSION_DIR = `${DATA_PATH}/auth_barpay`;
const PORT = process.env.PORT || 3003;
const FLY_APP_URL = 'https://bar-pay.app.fly.io';
// ⚠️ ATENÇÃO: ID de conta para TESTE da API. Substitua pelo ID da sua conta de teste do Supabase.
const CONTA_ID_TESTE_API = '6b749ef5-31ce-425a-bab0-96aaa4cd3906';


// --- Variáveis Globais ---
let sock;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// =================================================================
// --- SEÇÃO 1: SERVIDOR WEB E API ---
// =================================================================
app.use(cors({ origin: FLY_APP_URL }));
app.use(express.json());
wss.on('connection', ws => console.log('✅ Portal conectado via WebSocket.'));

function broadcast(obj) {
    const data = JSON.stringify(obj);
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) client.send(data);
    });
}

// ATENÇÃO: As rotas da API abaixo estão usando um ID de conta FIXO para testes.
// No futuro, isso será substituído por um sistema de autenticação de verdade.
app.get('/api/clientes', async (req, res) => {
    try {
        const clientes = await db.listarClientes(CONTA_ID_TESTE_API);
        res.json(clientes);
    } catch (e) { res.status(500).json({ message: "Erro ao buscar clientes." }); }
});
app.get('/api/produtos', async (req, res) => {
    try {
        const produtos = await db.listarProdutos(CONTA_ID_TESTE_API);
        res.json(produtos);
    } catch (e) { res.status(500).json({ message: "Erro ao buscar produtos." }); }
});
app.post('/api/venda', async (req, res) => {
    try {
        const { clienteId, produtoId, produtoNome, quantidade, valorUnitario } = req.body;
        let produtoFinalId = produtoId;
        if (!produtoId && produtoNome) {
            const novoProduto = await db.encontrarOuCriarProduto(produtoNome, valorUnitario, CONTA_ID_TESTE_API);
            produtoFinalId = novoProduto.id;
        }
        await db.adicionarVenda({ clienteId, produtoId: produtoFinalId, quantidade, valorUnitario, contaId: CONTA_ID_TESTE_API });
        const cliente = await db.encontrarClientePorId(clienteId, CONTA_ID_TESTE_API);
        const valorTotal = quantidade * valorUnitario;
        broadcast({ type: 'NOVA_VENDA', payload: { clienteNome: cliente.nome, valor: valorTotal.toFixed(2) } });
        res.status(201).json({ message: "Venda adicionada com sucesso pelo portal!" });
    } catch (e) { res.status(500).json({ message: "Erro interno ao salvar a venda." }); }
});

// =================================================================
// --- SEÇÃO 2: LÓGICA DO WHATSAPP (Agora com Multi-Contas) ---
// =================================================================

async function responder(jid, text) {
    if (sock) await sock.sendMessage(jid, { text });
}

function analisarItensDoPedido(textoDoPedido) {
    // ... (Esta função continua a mesma)
    const palavras = textoDoPedido.trim().split(/\s+/);
    const itens = [];
    let i = 0;
    while (i < palavras.length) {
        const quantidade = parseFloat(palavras[i]);
        if (isNaN(quantidade) || quantidade <= 0) { i++; continue; }
        i++;
        let nomePartes = [];
        while (i < palavras.length && isNaN(parseFloat(palavras[i]))) {
            nomePartes.push(palavras[i]);
            i++;
        }
        if (nomePartes.length === 0) continue;
        const nomeProduto = nomePartes.join(' ');
        let valorTotal = 0;
        if (i < palavras.length && !isNaN(parseFloat(palavras[i]))) {
            valorTotal = parseFloat(palavras[i]);
            i++;
        }
        itens.push({
            quantidade,
            nome: nomeProduto,
            valorTotal: valorTotal,
            valorUnitario: valorTotal > 0 ? valorTotal / quantidade : 0
        });
    }
    return itens;
}

async function processarMensagem(msg) {
    const jid = msg.key.remoteJid;
    if (msg.key.fromMe) return;

    // Lógica de Suporte para Mensagens Privadas
    if (!jid.endsWith('@g.us')) {
        return await responder(jid, 'Olá! Este canal é para suporte. Para gerenciar suas vendas, por favor, use o grupo de gerenciamento que criei para você.');
    }

    // --- LÓGICA DE NEGÓCIO (APENAS GRUPOS) ---
    // 1. Descobrir a qual conta este grupo pertence
    const conta = await db.encontrarContaPorGrupoId(jid);

    // 2. Trava de Segurança: Se o grupo não está cadastrado, ignora a mensagem.
    if (!conta) {
        console.log(`Mensagem recebida de grupo não cadastrado: ${jid}`);
        return;
    }
    const contaId = conta.id; // A chave mestra para todas as operações!

    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    if (!texto) return;

    const [primeiraPalavra, ...resto] = texto.split(' ');
    const comando = primeiraPalavra.toLowerCase();

    if (comando.startsWith('/')) {
        const nomeClienteCmd = resto.join(' ');
        switch (comando) {
            case '/novocliente':
                if (!nomeClienteCmd) return await responder(jid, '⚠️ Formato: /novocliente <nome>');
                const resCliente = await db.adicionarCliente(nomeClienteCmd, contaId);
                await responder(jid, resCliente.message);
                break;
            case '/produtos':
                const produtos = await db.listarProdutos(contaId);
                if (produtos.length === 0) return await responder(jid, 'ℹ️ Nenhum produto cadastrado.');
                let listaProdutos = '*Produtos Cadastrados:*\n\n';
                produtos.forEach(p => { listaProdutos += `- ${p.nome}\n`; });
                await responder(jid, listaProdutos);
                break;
            case '/extrato':
                if (!nomeClienteCmd) return await responder(jid, '⚠️ Formato: /extrato <nome>');
                const clienteExtrato = await db.encontrarClientePorNome(nomeClienteCmd, contaId);
                if (!clienteExtrato) return await responder(jid, `❌ Cliente "${nomeClienteCmd}" não encontrado.`);
                const extrato = await db.gerarExtrato(clienteExtrato.id, contaId);
                if (extrato.length === 0) return await responder(jid, `✅ *${clienteExtrato.nome}* não tem dívidas.`);
                let textoExtrato = `*Extrato de ${clienteExtrato.nome}*\n\n`;
                let totalDivida = 0;
                extrato.forEach(item => {
                    totalDivida += item.valor_total;
                    textoExtrato += `${new Date(item.created_at).toLocaleDateString('pt-BR')} - ${item.quantidade}x ${item.produtos.nome} - R$ ${item.valor_total.toFixed(2)}\n`;
                });
                textoExtrato += `\n*TOTAL: R$ ${totalDivida.toFixed(2)}*`;
                await responder(jid, textoExtrato);
                break;
            case '/pago':
                if (!nomeClienteCmd) return await responder(jid, '⚠️ Formato: /pago <nome>');
                const clientePago = await db.encontrarClientePorNome(nomeClienteCmd, contaId);
                if (!clientePago) return await responder(jid, `❌ Cliente "${nomeClienteCmd}" não encontrado.`);
                const quitado = await db.quitarDivida(clientePago.id, contaId);
                await responder(jid, quitado ? `✅ Dívida de *${clientePago.nome}* quitada!` : `ℹ️ *${clientePago.nome}* não tinha dívidas.`);
                break;
            case '/ajuda':
                const menuAjuda = `*BarPay - Comandos Disponíveis* 🤖

*/novocliente <nome>*
Adiciona um novo cliente.
_Ex: /novocliente Jhey_

*/produtos*
Lista todos os produtos cadastrados.

*/extrato <nome_cliente>*
Mostra a dívida detalhada de um cliente.

*/pago <nome_cliente>*
Zera a dívida de um cliente.

*COMO LANÇAR UMA VENDA:*
Basta escrever o nome do cliente, seguido dos itens.
_Formato: <nome> <qtd> <produto> <valor_total>_

*Exemplo simples:*
\`\`\`Jhey 1 latão 5\`\`\`

*Exemplo com múltiplos itens:*
\`\`\`Ronaldo 2 pinga 4 1 suco 2\`\`\``;
                await responder(jid, menuAjuda);
                break;
            default:
                await responder(jid, `Comando "${comando}" não reconhecido. Digite */ajuda* para ver a lista de comandos.`);
                break;
        }
        return;
    }

    // --- LÓGICA DE REGISTRO DE VENDA (TEXTO LIVRE) ---
    try {
        const clienteVenda = await db.encontrarClientePorNome(comando, contaId);
        if (!clienteVenda) return await responder(jid, `🤔 Cliente "${comando}" não encontrado. Use: */novocliente ${comando}*`);
        
        const textoDoPedido = resto.join(' ');
        const itens = analisarItensDoPedido(textoDoPedido);
        if (itens.length === 0) return await responder(jid, `⚠️ Não entendi os itens do pedido. Use o formato: <qtd> <produto> <valor>`);

        let valorTotalVenda = 0;
        let resumoVenda = `✅ Venda registrada para *${clienteVenda.nome}*:\n`;
        for (const item of itens) {
            const produto = await db.encontrarOuCriarProduto(item.nome, item.valorUnitario, contaId);
            await db.adicionarVenda({ clienteId: clienteVenda.id, produtoId: produto.id, quantidade: item.quantidade, valorUnitario: item.valorUnitario, contaId: contaId });
            valorTotalVenda += item.valorTotal;
            resumoVenda += `\n- ${item.quantidade}x ${item.nome} (R$ ${item.valorTotal.toFixed(2)})`;
        }
        resumoVenda += `\n\n*Total da Venda: R$ ${valorTotalVenda.toFixed(2)}*`;
        await responder(jid, resumoVenda);

        const dividaAtual = await db.calcularDividaTotal(clienteVenda.id, contaId);
        // ... (lógica de limite de crédito)

    } catch (e) { console.error("Erro ao processar venda:", e); await responder(jid, "❌ Erro ao registrar a venda."); }
}

// =================================================================
// --- SEÇÃO 3: FUNÇÃO PRINCIPAL (INICIA TUDO) ---
// =================================================================
async function startApp() {
    server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor da API escutando na porta ${PORT}`));

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    sock = makeWASocket({ auth: state, printQRInTerminal: false, browser: ['BarPay-App', 'Chrome', '1.0'] });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') console.log('✅ Bot WhatsApp conectado!');
        if (connection === 'close') {
            const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`🔄 Conexão do WhatsApp fechada (Motivo: ${motivo}). Reiniciando...`);
            process.exit(1);
        }
    });
    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (messages[0]?.message) await processarMensagem(messages[0]);
    });
}

startApp().catch(e => console.error('❌ Erro fatal ao iniciar a aplicação:', e));
