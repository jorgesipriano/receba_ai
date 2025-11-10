import { supabase } from './supabaseClient.js';

// --- FUNÇÃO AUXILIAR DE NORMALIZAÇÃO ---
function normalizarString(texto) {
    if (!texto) return '';
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// --- Funções de Contas (SaaS) ---
async function encontrarContaPorGrupoId(grupoId) {
    const { data, error } = await supabase.from('contas').select('*').eq('grupo_id_whatsapp', grupoId).single();
    if (error && error.code !== 'PGRST116') console.error('Erro:', error);
    return data;
}

async function encontrarContaPorNumeroDono(numeroDono) {
    const { data, error } = await supabase.from('contas').select('*').eq('whatsapp_dono', numeroDono).single();
    if (error && error.code !== 'PGRST116') console.error('Erro:', error);
    return data;
}

async function listarContas() {
    const { data, error } = await supabase.from('contas').select('*').order('nome_do_bar');
    if (error) throw error;
    return data || [];
}

async function adicionarConta(dadosConta) {
    const { data, error } = await supabase.from('contas').insert(dadosConta).select().single();
    if (error) throw error;
    return data;
}

// --- Funções de Clientes ---
async function adicionarCliente(nome, contaId) {
    const nomeNormalizado = normalizarString(nome);
    const { data: clienteExistente } = await supabase.from('clientes').select('id').eq('nome_normalizado', nomeNormalizado).eq('conta_id', contaId).maybeSingle();
    if (clienteExistente) {
        const { data: clienteData } = await supabase.from('clientes').select('*').eq('id', clienteExistente.id).single();
        return { success: false, reason: 'duplicate', cliente: clienteData };
    }
    const { data, error } = await supabase.from('clientes').insert({ nome, nome_normalizado: nomeNormalizado, conta_id: contaId }).select().single();
    if (error) throw error;
    return { success: true, cliente: data, message: `✅ Cliente "*${nome}*" cadastrado com sucesso!` };
}

async function excluirCliente(clienteId, contaId) {
    try {
        await supabase.from('vendas').delete().eq('cliente_id', clienteId).eq('conta_id', contaId);
        await supabase.from('clientes').delete().eq('id', clienteId).eq('conta_id', contaId);
        return { success: true };
    } catch (error) {
        console.error("Erro ao excluir cliente:", error);
        return { success: false, error };
    }
}

async function buscarClientePorNome(nome, contaId) {
    const nomeNormalizado = normalizarString(nome);
    const { data, error } = await supabase.from('clientes').select('*').eq('nome_normalizado', nomeNormalizado).eq('conta_id', contaId).maybeSingle();
    if (error && error.code === 'PGRST116') return null; // Retorna nulo se houver duplicatas
    if (error) throw error;
    return data;
}

async function buscarTodosClientesPorNome(nome, contaId) {
    const nomeNormalizado = normalizarString(nome);
    const { data, error } = await supabase.from('clientes').select('*').eq('nome_normalizado', nomeNormalizado).eq('conta_id', contaId);
    if (error) throw error;
    return data || [];
}

async function buscarClientesSimilares(nome, contaId) {
    const nomeTratado = nome.trim().split(' ')[0];
    const nomeNormalizado = normalizarString(nomeTratado);
    const { data, error } = await supabase.from('clientes').select('id, nome').ilike('nome_normalizado', `%${nomeNormalizado}%`).eq('conta_id', contaId).limit(3);
    if (error) throw error;
    return data || [];
}

async function listarTodosClientes(contaId) {
    const { data, error } = await supabase.from('clientes').select('id, nome').eq('conta_id', contaId).order('nome');
    if (error) throw error;
    return data || [];
}

// --- Funções de Vendas ---
async function adicionarVenda(venda) {
    const { error } = await supabase.from('vendas').insert(venda);
    if (error) throw error;
}

async function calcularDividaTotal(clienteId, contaId) {
    const { data, error } = await supabase.from('vendas').select('valor_total').eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false);
    if (error) return 0;
    return data.reduce((acc, item) => acc + item.valor_total, 0);
}

async function calcularDividaGeral(contaId) {
    const { data, error } = await supabase.from('vendas').select('valor_total').eq('conta_id', contaId).eq('pago', false);
    if (error) return 0;
    return data.reduce((acc, item) => acc + item.valor_total, 0);
}

async function quitarDivida(clienteId, contaId) {
    const { error } = await supabase.from('vendas').update({ pago: true }).eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false);
    return !error;
}

async function gerarExtrato(clienteId, contaId) {
    const { data, error } = await supabase.from('vendas').select('*').eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false).order('created_at');
    if (error) throw error;
    return data || [];
}

// --- Funções Administrativas / Auxiliares ---
async function adicionarBlackout(jid, horas) {
    const expires_at = new Date();
    expires_at.setHours(expires_at.getHours() + horas);
    const { error } = await supabase.from('blackouts').upsert({ jid, expires_at });
    if (error) throw error;
}

async function unificarClientes(nome, contaId) {
    const nomeNormalizado = normalizarString(nome);
    const { data: clientes, error } = await supabase.from('clientes').select('id, nome').eq('nome_normalizado', nomeNormalizado).eq('conta_id', contaId);
    if (error) throw error;
    if (!clientes || clientes.length < 2) {
        return { success: false, message: `Não foram encontrados clientes duplicados para o nome "${nome}".` };
    }
    const clienteMestre = clientes[0];
    const clonesParaRemover = clientes.slice(1);
    const idsClones = clonesParaRemover.map(c => c.id);
    const { error: updateError } = await supabase.from('vendas').update({ cliente_id: clienteMestre.id }).in('cliente_id', idsClones);
    if (updateError) {
        console.error("Erro ao unificar vendas:", updateError);
        return { success: false, message: "Ocorreu um erro ao reatribuir as vendas." };
    }
    const { error: deleteError } = await supabase.from('clientes').delete().in('id', idsClones);
    if (deleteError) {
        console.error("Erro ao deletar clientes clones:", deleteError);
        return { success: false, message: "Ocorreu um erro ao deletar os clientes duplicados." };
    }
    return { success: true, message: `✅ Clientes duplicados foram unificados em "*${clienteMestre.nome}*".` };
}

// --- EXPORTAÇÃO COMPLETA E CORRIGIDA ---
export default {
    // Contas
    encontrarContaPorGrupoId,
    encontrarContaPorNumeroDono,
    listarContas,
    adicionarConta,
    // Clientes
    adicionarCliente,
    excluirCliente,
    buscarClientePorNome,
    buscarTodosClientesPorNome,
    buscarClientesSimilares,
    listarTodosClientes,
    // Vendas
    adicionarVenda,
    calcularDividaTotal,
    calcularDividaGeral,
    quitarDivida,
    gerarExtrato,
    // Admin/Aux
    adicionarBlackout,
    unificarClientes,
};
