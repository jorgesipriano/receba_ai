import cron from 'node-cron';
import db from './database.js';
import dbRelatorios from './dbrelatorios.js';

export function iniciarAgendamentos(sock) {
    console.log('⏰ Agendador de tarefas com relatórios aprimorados configurado.');
    const timezone = "America/Sao_Paulo";

    // Relatório Diário - Todo dia às 23:00
    cron.schedule('0 23 * * *', async () => {
        console.log('[CRON] Executando tarefa de fechamento do dia...');
        try {
            const contas = await db.listarContas();
            for (const conta of contas) {
                const relatorio = await dbRelatorios.gerarRelatorioFechamentoDia(conta.id);
                if (relatorio && (relatorio.totalVendido > 0 || relatorio.totalRecebido > 0)) {
                    let mensagem = `🌙 *Fechamento do Dia - ${new Date().toLocaleDateString('pt-BR')}* 📊\n\n`;
                    mensagem += `• *Total Vendido:* R$ ${relatorio.totalVendido.toFixed(2)}\n`;
                    mensagem += `• *Total Recebido:* R$ ${relatorio.totalRecebido.toFixed(2)}\n`;
                    if (relatorio.clientesFiado.length > 0) {
                        mensagem += `\n*Compras registradas hoje:*\n`;
                        relatorio.clientesFiado.forEach(([nome, valor]) => {
                            mensagem += `  - ${nome}: R$ ${valor.toFixed(2)}\n`;
                        });
                    }
                    mensagem += `\nBom descanso! 💤`;
                    await sock.sendMessage(conta.grupo_id_whatsapp, { text: mensagem });
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        } catch (error) {
            console.error('[CRON] Erro no fechamento do dia:', error);
        }
    }, { scheduled: true, timezone });

    // Relatório Semanal - Toda Segunda-feira às 09:00
    cron.schedule('0 9 * * 1', async () => {
        console.log('[CRON] Executando tarefa de relatório semanal...');
        try {
            const contas = await db.listarContas();
            for (const conta of contas) {
                // CORREÇÃO AQUI
                const dados = await dbRelatorios.gerarDadosRelatorioSemanal(conta.id);
                let mensagem = `📅 *Resumo da Semana* (${dados.periodo})\n\n`;
                mensagem += `• *Faturamento na semana:* R$ ${dados.totalVendido.toFixed(2)}\n`;
                mensagem += `• *Saldo devedor total atual:* R$ ${dados.dividaTotalAtual.toFixed(2)}\n\n`;
                if (dados.dividasAntigasCount > 0) {
                    mensagem += `🚨 *Atenção:* Você possui *${dados.dividasAntigasCount}* cliente(s) com dívidas há mais de 30 dias. Considere usar o comando \`.devedores\` para mais detalhes.`;
                } else {
                    mensagem += `✅ Ótima notícia! Nenhuma dívida com mais de 30 dias registrada.`;
                }
                mensagem += `\n\nTenha uma excelente semana!`;
                await sock.sendMessage(conta.grupo_id_whatsapp, { text: mensagem });
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        } catch (error) {
            console.error('[CRON] Erro no relatório semanal:', error);
        }
    }, { scheduled: true, timezone });

    // Relatório Mensal - Todo dia 1º do mês às 09:00
    cron.schedule('0 9 1 * *', async () => {
        console.log('[CRON] Executando tarefa de relatório mensal...');
        try {
            const contas = await db.listarContas();
            for (const conta of contas) {
                // CORREÇÃO AQUI
                const dados = await dbRelatorios.gerarDadosRelatorioMensal(conta.id);
                let mensagem = `🗓️ *Fechamento do Mês de ${dados.mes}* 🎉\n\n`;
                mensagem += `Parabéns pelo seu desempenho no último mês!\n\n`;
                mensagem += `• *Faturamento Total:* R$ ${dados.totalFaturado.toFixed(2)}\n`;
                mensagem += `• *Número de Vendas:* ${dados.numVendas}\n\n`;
                if (dados.melhoresClientes.length > 0) {
                    mensagem += `*Seus melhores clientes no mês foram:*\n`;
                    dados.melhoresClientes.forEach(([nome, valor], index) => {
                        mensagem += `${index + 1}º - ${nome} (R$ ${valor.toFixed(2)})\n`;
                    });
                }
                mensagem += `\nQue este novo mês seja ainda melhor!`;
                await sock.sendMessage(conta.grupo_id_whatsapp, { text: mensagem });
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        } catch (error) {
            console.error('[CRON] Erro no relatório mensal:', error);
        }
    }, { scheduled: true, timezone });
}
