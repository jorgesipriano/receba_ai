import { supabase } from './supabaseClient.js';
import readline from 'readline';

// --- CONFIGURAÇÃO ---
// Escreva aqui o nome do cliente que você quer excluir completamente.
// O script vai achar todas as variações (maiúsculas, minúsculas, com e sem acento).
const NOME_PARA_EXCLUIR = 'Fabricio';

// --- FUNÇÃO DE NORMALIZAÇÃO ---
// (Copiada aqui para o script funcionar de forma independente)
function normalizarString(texto) {
    if (!texto) return '';
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Interface para ler a entrada do usuário no terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function excluirClientePorNome() {
    console.log(`--- Iniciando script para excluir o cliente: "${NOME_PARA_EXCLUIR}" ---`);
    const nomeNormalizado = normalizarString(NOME_PARA_EXCLUIR);

    // 1. Encontra todos os clientes que correspondem ao nome normalizado
    const { data: clientes, error: findError } = await supabase
        .from('clientes')
        .select('id, nome')
        .eq('nome_normalizado', nomeNormalizado);

    if (findError) {
        console.error('❌ Erro ao buscar clientes:', findError.message);
        rl.close();
        return;
    }

    if (!clientes || clientes.length === 0) {
        console.log(`✅ Nenhum cliente encontrado com o nome "${NOME_PARA_EXCLUIR}". Nenhuma ação necessária.`);
        rl.close();
        return;
    }

    // 2. Mostra para o usuário o que será apagado e pede confirmação
    console.log('\n🚨🚨🚨 ATENÇÃO! AÇÃO DESTRUTIVA! 🚨🚨🚨');
    console.log('Os seguintes clientes (e todas as suas vendas associadas) serão EXCLUÍDOS PERMANENTEMENTE:');
    clientes.forEach(c => {
        console.log(`  - ID: ${c.id}, Nome: "${c.nome}"`);
    });

    rl.question('\nPara confirmar a exclusão, digite "sim": ', async (resposta) => {
        if (resposta.toLowerCase() !== 'sim') {
            console.log('\n❌ Operação cancelada pelo usuário.');
            rl.close();
            return;
        }

        try {
            console.log('\n🔄 Iniciando processo de exclusão...');
            for (const cliente of clientes) {
                console.log(`  -> Processando cliente "${cliente.nome}" (ID: ${cliente.id})`);

                // 3. Exclui as VENDAS do cliente
                console.log(`     -> Excluindo vendas...`);
                const { error: vendasError } = await supabase
                    .from('vendas')
                    .delete()
                    .eq('cliente_id', cliente.id);
                if (vendasError) throw new Error(`Erro ao excluir vendas do cliente ${cliente.id}: ${vendasError.message}`);

                // 4. Exclui o CLIENTE
                console.log(`     -> Excluindo o registro do cliente...`);
                const { error: clienteError } = await supabase
                    .from('clientes')
                    .delete()
                    .eq('id', cliente.id);
                if (clienteError) throw new Error(`Erro ao excluir o cliente ${cliente.id}: ${clienteError.message}`);

                console.log(`  -> ✅ Cliente "${cliente.nome}" excluído com sucesso.`);
            }
            console.log(`\n🚀 Limpeza concluída! ${clientes.length} registro(s) de cliente(s) foram removidos.`);

        } catch (error) {
            console.error('\n❌ Ocorreu um erro durante a exclusão:', error.message);
        } finally {
            rl.close();
        }
    });
}

excluirClientePorNome();
