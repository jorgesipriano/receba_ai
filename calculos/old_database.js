import { supabase } from './supabaseClient.js';

// --- Funções de Contas (SaaS) ---

async function encontrarContaPorGrupoId(grupoId) {
    const { data, error } = await supabase.from('contas').select('*').eq('grupo_id_whatsapp', grupoId).single();
    if (error && error.code !== 'PGRST116') console.error('Erro ao encontrar conta por grupoId:', error);
    return data;
}

// NOVA FUNÇÃO: Encontrar conta pelo número do dono
async function encontrarContaPorNumeroDono(numeroDono) {
    const { data, error } = await supabase.from('contas').select('*').eq('whatsapp_dono', numeroDono).single();
    if (error && error.code !== 'PGRST116') console.error('Erro ao encontrar conta por número do dono:', error);
    return data;
}

// NOVA FUNÇÃO: Listar todas as contas de bares
async function listarContas() {
    const { data, error } = await supabase.from('contas').select('*').order('nome_do_bar');
    if (error) {
        console.error('Erro ao listar contas:', error);
        throw error;
    }
    return data || [];
}

async function adicionarConta(dadosConta) {
    const { data, error } = await supabase.from('contas').insert(dadosConta).select().single();
    if (error) {
        console.error('Erro ao adicionar nova conta:', error);
        throw error;
    }
    return data;
}

// --- Funções de Clientes ---

async function adicionarCliente(nome, contaId) {
    const { error } = await supabase.from('clientes').insert({ nome, conta_id: contaId });
    if (error) {
        console.error('Erro ao adicionar cliente:', error);
        throw error;
    }
    return { success: true, message: `Cliente "${nome}" adicionado com sucesso!` };
}

async function encontrarClientePorNome(nome, contaId) {
    const { data, error } = await supabase.from('clientes').select('*').ilike('nome', nome).eq('conta_id', contaId).single();
    if (error && error.code !== 'PGRST116') console.error('Erro ao encontrar cliente por nome:', error);
    return data;
}

async function listarTodosClientes(contaId) {
    const { data, error } = await supabase.from('clientes').select('id, nome').eq('conta_id', contaId).order('nome');
    if (error) {
        console.error('Erro ao listar todos os clientes:', error);
        throw error;
    }
    return data || [];
}

async function alterarNomeCliente(id, novoNome, contaId) {
    const { data, error } = await supabase
        .from('clientes')
        .update({ nome: novoNome })
        .eq('id', id)
        .eq('conta_id', contaId)
        .select();
    if (error) {
        console.error('Erro ao alterar nome do cliente:', error);
        throw error;
    }
    return data;
}

async function excluirCliente(id, contaId) {
    const { error } = await supabase
        .from('clientes')
        .delete()
        .eq('id', id)
        .eq('conta_id', contaId);
    if (error) {
        console.error('Erro ao excluir cliente:', error);
        throw error;
    }
}

// --- Funções de Vendas e Dívidas ---
async function adicionarVenda({ clienteId, quantidade, valorUnitario, valorTotal, descricaoProduto, contaId, dataVenda }) {
    const vendaParaInserir = {
        cliente_id: clienteId,
        quantidade,
        valor_unitario: valorUnitario,
        valor_total: valorTotal,
        descricao_produto: descricaoProduto,
        conta_id: contaId
    };

    // Se uma data específica foi fornecida (pelo script de importação), usa ela.
    // O Supabase precisa da data no formato de texto ISO 8601.
    if (dataVenda) {
        vendaParaInserir.created_at = dataVenda;
    }

    const { error } = await supabase.from('vendas').insert(vendaParaInserir);
    
    if (error) {
        console.error('Erro ao adicionar venda:', error);
        throw error;
    }
}

async function gerarExtrato(clienteId, contaId) {
    const { data, error } = await supabase.from('vendas').select('*').eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false).order('created_at');
    if (error) {
        console.error('Erro ao gerar extrato:', error);
        throw error;
    }
    return data || [];
}

async function quitarDivida(clienteId, contaId) {
    const { error, count } = await supabase
        .from('vendas')
        .update({ pago: true })
        .eq('cliente_id', clienteId)
        .eq('conta_id', contaId)
        .eq('pago', false);

    // Se ocorrer um erro na operação, retorna falha.
    if (error) {
        console.error('Erro ao quitar dívida:', error);
        return false;
    }

    // Log para depuração, mostrando o que o Supabase retornou.
    console.log(`[QUITAÇÃO] Operação para cliente ${clienteId} finalizada. Count retornado: ${count}`);
    
    // Se não houve erro, a operação é considerada um sucesso.
    return true;
}

async function calcularDividaTotal(clienteId, contaId) {
    const { data, error } = await supabase.from('vendas').select('valor_total').eq('cliente_id', clienteId).eq('conta_id', contaId).eq('pago', false);
    if (error) {
        console.error('Erro ao calcular dívida:', error);
        return 0;
    }
    return data.reduce((acc, item) => acc + item.valor_total, 0);
}

// --- Funções de Relatórios ---

async function gerarRelatorioVendas(contaId, filtroData) {
    const inicioDoDia = `${filtroData}T00:00:00.000Z`;
    const fimDoDia = `${filtroData}T23:59:59.999Z`;

    let { data, error } = await supabase
        .from('vendas')
        .select(`
            created_at,
            quantidade,
            valor_total,
            descricao_produto,
            clientes ( nome )
        `)
        .eq('conta_id', contaId)
        .gte('created_at', inicioDoDia)
        .lt('created_at', fimDoDia)
        .order('created_at');

    if (error) {
        console.error('Erro ao gerar relatório de vendas:', error);
        throw error;
    }
    return data.map(item => ({...item, cliente_nome: item.clientes?.nome || 'Desconhecido'})) || [];
}

// NOVA FUNÇÃO: Gerar relatório de vendas por mês/ano para uma conta
async function gerarRelatorioVendasPorConta(contaId, mesAno) { // formato YYYY-MM
    const inicioDoMes = `${mesAno}-01T00:00:00.000Z`;
    const fimDoMes = new Date(new Date(inicioDoMes).getFullYear(), new Date(inicioDoMes).getMonth() + 1, 1);
    const fimDoMesISO = fimDoMes.toISOString();

    let { data, error } = await supabase
        .from('vendas')
        .select('valor_total')
        .eq('conta_id', contaId)
        .gte('created_at', inicioDoMes)
        .lt('created_at', fimDoMesISO);

    if (error) {
        console.error('Erro ao gerar relatório de vendas por conta:', error);
        throw error;
    }
    return data || [];
}

// --- Funções de Blackout ---
// (Lembre-se que estas funções dependem da tabela 'blackouts' no Supabase)
async function adicionarBlackout(jid, horas) {
    const blackoutUntil = new Date(Date.now() + horas * 60 * 60 * 1000);
    const { error } = await supabase.from('blackouts').upsert({ jid, blackout_until: blackoutUntil }, { onConflict: 'jid' });
    if (error) throw error;
}

async function isEmBlackout(jid) {
    const { data, error } = await supabase.from('blackouts').select('blackout_until').eq('jid', jid).single();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return false;
    return new Date() < new Date(data.blackout_until);
}

// EXPORTAÇÃO ATUALIZADA
export default {
    encontrarContaPorGrupoId,
    adicionarConta,
    adicionarCliente,
    encontrarClientePorNome,
    listarTodosClientes,
    alterarNomeCliente,
    excluirCliente,
    adicionarVenda,
    gerarExtrato,
    quitarDivida,
    calcularDividaTotal,
    gerarRelatorioVendas,
    adicionarBlackout,
    isEmBlackout,
    // --- NOVAS FUNÇÕES EXPORTADAS ---
    encontrarContaPorNumeroDono,
    listarContas,
    gerarRelatorioVendasPorConta
};
