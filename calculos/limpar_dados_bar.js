import db from './database.js';
import { supabase } from './supabaseClient.js'; // <--- ADIÇÃO IMPORTANTE AQUI
import readline from 'readline';

// --- CONFIGURAÇÃO ---
// !!! IMPORTANTE !!!
// Coloque aqui o ID da conta do bar cujos dados você quer EXCLUIR.
// Lembre-se de mantê-lo DENTRO DAS ASPAS!
const ID_DA_CONTA_DO_BAR = '61cd3228-18fa-48d3-9cc0-dc1f81b2c3ea'; // <--- VERIFIQUE SE ESTE É O ID CORRETO

// Interface para ler a entrada do usuário no terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function limparDados() {
    console.log('--- Iniciando script de LIMPEZA DE DADOS ---');

    if (!ID_DA_CONTA_DO_BAR || ID_DA_CONTA_DO_BAR.includes('COLOQUE-SEU-ID-AQUI')) {
        console.error('\n❌ ERRO: Você precisa definir o ID_DA_CONTA_DO_BAR no topo do script antes de executar!');
        rl.close();
        return;
    }

    // Busca a conta para confirmar o nome do bar para o usuário
    const todasContas = await db.listarContas();
    const conta = todasContas.find(c => c.id === ID_DA_CONTA_DO_BAR);

    if (!conta) {
        console.error(`\n❌ ERRO: Nenhuma conta encontrada com o ID: ${ID_DA_CONTA_DO_BAR}`);
        rl.close();
        return;
    }

    console.log('\n🚨🚨🚨 ATENÇÃO! AÇÃO DESTRUTIVA! 🚨🚨🚨');
    console.log(`Você está prestes a excluir TODOS os clientes e TODAS as vendas do bar:`);
    console.log(`\n  >>>>> *${conta.nome_do_bar}* <<<<<`);
    console.log(`\nEsta ação não pode ser desfeita. Verifique se você fez um BACKUP.`);

    rl.question('\nPara confirmar, digite "sim": ', async (resposta) => {
        if (resposta.toLowerCase() !== 'sim') {
            console.log('\n❌ Operação cancelada pelo usuário.');
            rl.close();
            return;
        }

        try {
            console.log(`\n🔄 Excluindo vendas do bar "${conta.nome_do_bar}"...`);
            // É preciso primeiro excluir as vendas, que dependem dos clientes
            const { error: vendasError } = await supabase // <--- USANDO O SUPABASE DIRETAMENTE
                .from('vendas')
                .delete()
                .eq('conta_id', ID_DA_CONTA_DO_BAR);

            if (vendasError) throw vendasError;
            console.log('✅ Vendas excluídas com sucesso.');

            console.log(`🔄 Excluindo clientes do bar "${conta.nome_do_bar}"...`);
            const { error: clientesError } = await supabase // <--- USANDO O SUPABASE DIRETAMENTE
                .from('clientes')
                .delete()
                .eq('conta_id', ID_DA_CONTA_DO_BAR);
            
            if (clientesError) throw clientesError;
            console.log('✅ Clientes excluídos com sucesso.');

            console.log(`\n🚀 Limpeza do bar "${conta.nome_do_bar}" concluída!`);
            console.log('Agora você já pode executar o script "importar_dados.js" para inserir os novos dados.');

        } catch (error) {
            console.error('\n❌ Ocorreu um erro durante a exclusão:', error.message);
            console.error('Os dados podem ter sido parcialmente excluídos. Verifique o painel do Supabase.');
        } finally {
            rl.close();
        }
    });
}

// A linha com erro foi removida daqui.

limparDados();
