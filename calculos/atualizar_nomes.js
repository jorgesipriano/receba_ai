import db from './database.js';
import { supabase } from './supabaseClient.js';

/**
 * Função que normaliza uma string (remove acentos, etc.).
 */
function normalizarString(texto) {
    if (!texto) return '';
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function atualizarNomesAntigos() {
    console.log('--- Iniciando atualização dos nomes de clientes existentes ---');

    // 1. Busca todos os clientes que ainda não têm um nome normalizado
    const { data: clientes, error } = await supabase
        .from('clientes')
        .select('id, nome')
        .is('nome_normalizado', null); // Pega apenas os que precisam de atualização

    if (error) {
        console.error('❌ Erro ao buscar clientes:', error.message);
        return;
    }

    if (!clientes || clientes.length === 0) {
        console.log('✅ Nenhum cliente antigo para atualizar. Tudo certo!');
        return;
    }

    console.log(`Encontrados ${clientes.length} clientes para atualizar...`);
    let sucesso = 0;
    let falhas = 0;

    // 2. Para cada cliente, gera o nome normalizado e atualiza no banco
    for (const cliente of clientes) {
        const nomeNorm = normalizarString(cliente.nome);
        const { error: updateError } = await supabase
            .from('clientes')
            .update({ nome_normalizado: nomeNorm })
            .eq('id', cliente.id);

        if (updateError) {
            console.error(`❌ Falha ao atualizar "${cliente.nome}":`, updateError.message);
            falhas++;
        } else {
            console.log(`✅ Cliente "${cliente.nome}" atualizado!`);
            sucesso++;
        }
    }

    console.log('\n--- Atualização Concluída ---');
    console.log(`- Sucessos: ${sucesso}`);
    console.log(`- Falhas: ${falhas}`);
}

atualizarNomesAntigos();
