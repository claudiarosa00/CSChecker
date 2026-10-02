/*
============================================
CSChecker — Verificador de Materiais Criativos
Carrega vários materiais de uma vez, atribui a cada um (ou a todos de
uma vez) um formato da base de specs do CSBuilder, e verifica
automaticamente dimensões, peso, tipo de ficheiro e aspect ratio.
============================================
*/

let FORMATOS = [];
let itens = [];
let proximoIdItem = 1;
// Checklist opcional "o que esta entrega devia conter" — cada entrada é
// {id, formatoId, itemIdAssociado}. Quando um ficheiro carregado tem
// dimensões que batem com um formato aqui ainda sem material associado,
// é ligado automaticamente (ver tentarAutoAssociar).
let esperados = [];
let proximoIdEsperado = 1;

const zonaUpload = document.getElementById("zonaUpload");
const inputFicheiros = document.getElementById("inputFicheiros");
const inputPasta = document.getElementById("inputPasta");
const botaoEscolherFicheiros = document.getElementById("botaoEscolherFicheiros");
const botaoEscolherPasta = document.getElementById("botaoEscolherPasta");
const listaMateriais = document.getElementById("listaMateriais");
const barraAcoes = document.getElementById("barraAcoes");
const resumoVerificacao = document.getElementById("resumoVerificacao");
const botaoVerificarTudo = document.getElementById("botaoVerificarTudo");
const botaoLimparTudo = document.getElementById("botaoLimparTudo");
const inputFormatoLote = document.getElementById("inputFormatoLote");
const botaoAplicarLote = document.getElementById("botaoAplicarLote");
const inputFormatoEsperado = document.getElementById("inputFormatoEsperado");
const listaEsperados = document.getElementById("listaEsperados");
const inputPedidoExcel = document.getElementById("inputPedidoExcel");
const botaoImportarPedido = document.getElementById("botaoImportarPedido");
const pedidoResumo = document.getElementById("pedidoResumo");
const secaoRelatorio = document.getElementById("secaoRelatorio");
const listaRelatorio = document.getElementById("listaRelatorio");
const painelResultados = document.getElementById("painelResultados");
const notificacaoToast = document.getElementById("notificacaoToast");

let formatoLoteId = null;
let alvoPainelAtivo = null; // { tipo: "lote" } ou { tipo: "item", itemId }
let indiceAtivoPainel = -1;

/*
============================================
1. CARREGAR A BASE DE SPECS
============================================
*/
async function carregarSpecs() {
  try {
    const resposta = await fetch("data/specs.json");
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    FORMATOS = await resposta.json();
  } catch (erro) {
    mostrarToast("Não foi possível carregar a base de formatos (data/specs.json).");
    console.error(erro);
  }
}

/*
============================================
2. UTILITÁRIOS
============================================
*/
function formatarBytes(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatarDuracao(segundos) {
  if (segundos == null) return "—";
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function extensaoDoFicheiro(nome) {
  const partes = nome.split(".");
  if (partes.length < 2) return "";
  return partes.pop().toUpperCase();
}

// Alguns pares de extensões são o mesmo formato na prática — sem isto, um
// ficheiro ".jpeg" seria recusado por um formato que só lista "JPG".
const ALIASES_EXTENSAO = {
  JPEG: ["JPG"],
  JPG: ["JPEG"],
  MOV: ["MP4"],
  HTM: ["HTML"],
};

function tipoFicheiroAceite(extensao, tiposPermitidos) {
  if (!extensao) return false;
  if (tiposPermitidos.includes(extensao)) return true;
  const aliases = ALIASES_EXTENSAO[extensao] || [];
  return aliases.some((a) => tiposPermitidos.includes(a));
}

function mostrarToast(mensagem) {
  notificacaoToast.textContent = mensagem;
  notificacaoToast.hidden = false;
  clearTimeout(mostrarToast._timeout);
  mostrarToast._timeout = setTimeout(() => {
    notificacaoToast.hidden = true;
  }, 3200);
}

function rotuloFormato(formato) {
  const dimensoes = formato.dimensaoTexto ? ` — ${formato.dimensaoTexto}` : "";
  return `${formato.fornecedor} · ${formato.formato}${dimensoes}`;
}

function obterFormato(formatoId) {
  return FORMATOS.find((f) => f.id === formatoId) || null;
}

/*
============================================
3. LEITURA DE METADADOS DO FICHEIRO (dimensões/duração)
============================================
*/
function lerMetadados(file) {
  return new Promise((resolve) => {
    const extensao = extensaoDoFicheiro(file.name);
    const base = {
      tamanhoBytes: file.size,
      extensao,
      largura: null,
      altura: null,
      duracaoSeg: null,
      tipoMedia: "outro",
      urlObjeto: null,
    };

    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ ...base, tipoMedia: "imagem", largura: img.naturalWidth, altura: img.naturalHeight, urlObjeto: url });
      };
      img.onerror = () => resolve({ ...base, tipoMedia: "imagem", urlObjeto: url });
      img.src = url;
      return;
    }

    if (file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve({
          ...base,
          tipoMedia: "video",
          largura: video.videoWidth,
          altura: video.videoHeight,
          duracaoSeg: video.duration,
          urlObjeto: url,
        });
      };
      video.onerror = () => resolve({ ...base, tipoMedia: "video", urlObjeto: url });
      video.src = url;
      return;
    }

    resolve(base);
  });
}

/*
============================================
3.1 LEITURA DE UMA PASTA ARRASTADA (drag & drop)
O input[webkitdirectory] trata do caso "botão Carregar pasta" sozinho
(o browser já devolve todos os ficheiros com webkitRelativePath); isto
aqui é só para quando a pasta é arrastada para a zona de upload, que
exige percorrer a árvore de diretorias à mão via a File System API.
============================================
*/
function lerTodasEntradas(leitor) {
  return new Promise((resolve, reject) => {
    let todas = [];
    function lerLote() {
      leitor.readEntries((entradas) => {
        if (entradas.length === 0) {
          resolve(todas);
          return;
        }
        todas = todas.concat(entradas);
        lerLote();
      }, reject);
    }
    lerLote();
  });
}

async function percorrerEntrada(entry, caminho, resultado) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    resultado.push({ file, caminhoRelativo: caminho + file.name });
    return;
  }
  if (entry.isDirectory) {
    const leitor = entry.createReader();
    const entradas = await lerTodasEntradas(leitor);
    for (const sub of entradas) {
      await percorrerEntrada(sub, `${caminho}${entry.name}/`, resultado);
    }
  }
}

async function obterFicheirosDeDrop(dataTransfer) {
  const items = dataTransfer.items;
  if (!items || !items[0] || !items[0].webkitGetAsEntry) {
    // Browser sem suporte à File System API de drag & drop — mantém o
    // comportamento simples de antes (só ficheiros soltos, sem pastas).
    return Array.from(dataTransfer.files).map((file) => ({ file, caminhoRelativo: file.name }));
  }
  const entradas = Array.from(items)
    .map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry())
    .filter(Boolean);
  const resultado = [];
  for (const entry of entradas) {
    await percorrerEntrada(entry, "", resultado);
  }
  return resultado;
}

/*
============================================
4. ADICIONAR / REMOVER MATERIAIS
============================================
*/
async function adicionarFicheiros(fileList) {
  const ficheiros = Array.from(fileList);
  if (ficheiros.length === 0) return;
  await adicionarEntradas(ficheiros.map((file) => ({ file, caminhoRelativo: file.webkitRelativePath || file.name })));
}

async function adicionarEntradas(entradas) {
  if (entradas.length === 0) return;

  const itensDesteLote = [];
  for (const { file, caminhoRelativo } of entradas) {
    const item = {
      id: proximoIdItem++,
      file,
      nome: caminhoRelativo || file.name,
      tamanhoBytes: file.size,
      extensao: extensaoDoFicheiro(file.name),
      tipoMedia: "outro",
      largura: null,
      altura: null,
      duracaoSeg: null,
      urlObjeto: null,
      formatoId: null,
      esperadoId: null,
      resultado: null,
      aCarregar: true,
    };
    itens.push(item);
    itensDesteLote.push(item);
  }

  atualizarTudo();

  // Lê metadados em paralelo, cada item re-renderiza assim que fica pronto.
  await Promise.all(
    itensDesteLote.map(async (item) => {
      const metadados = await lerMetadados(item.file);
      Object.assign(item, metadados, { aCarregar: false });
    })
  );

  // Só depois de todos os metadados do lote estarem prontos é que faz
  // sentido tentar associar automaticamente (precisamos das dimensões).
  if (esperados.length > 0) {
    tentarAutoAssociar(itensDesteLote);
  }
  atualizarTudo();
}

function removerItem(id) {
  const item = itens.find((i) => i.id === id);
  if (!item) return;
  if (item.urlObjeto) URL.revokeObjectURL(item.urlObjeto);
  if (item.esperadoId) {
    const esperado = esperados.find((e) => e.id === item.esperadoId);
    if (esperado) esperado.itemIdAssociado = null;
  }
  itens = itens.filter((i) => i.id !== id);
  atualizarTudo();
}

function limparTudo() {
  itens.forEach((item) => {
    if (item.urlObjeto) URL.revokeObjectURL(item.urlObjeto);
  });
  itens = [];
  esperados.forEach((esperado) => {
    esperado.itemIdAssociado = null;
  });
  atualizarTudo();
}

/*
============================================
4.1 ASSOCIAÇÃO AUTOMÁTICA (ficheiro ↔ formato esperado)
Só liga automaticamente quando as dimensões do ficheiro batem
com exatamente UM formato esperado ainda por preencher — em caso de
ambiguidade (0 ou mais do que 1 candidato), fica por atribuir
manualmente, para nunca associar errado "à sorte".
============================================
*/
function tentarAutoAssociar(itensCandidatos) {
  itensCandidatos.forEach((item) => {
    if (item.formatoId || !item.largura || !item.altura) return;

    const candidatos = esperados.filter((esperado) => {
      if (esperado.itemIdAssociado) return false;
      const formato = obterFormato(esperado.formatoId);
      if (!formato) return false;
      return formato.dimensoes.some((d) => d.largura === item.largura && d.altura === item.altura);
    });

    if (candidatos.length === 1) {
      const esperado = candidatos[0];
      item.formatoId = esperado.formatoId;
      item.esperadoId = esperado.id;
      esperado.itemIdAssociado = item.id;
    }
  });
}

/*
============================================
5. VALIDAÇÃO
============================================
*/
const TOLERANCIA_ASPECT_RATIO = 0.02; // 2% — margem para arredondamentos

function validarItem(item, formato) {
  const criterios = [];

  // --- Tipo de ficheiro ---
  if (formato.tiposFicheiro && formato.tiposFicheiro.length > 0) {
    const aceite = tipoFicheiroAceite(item.extensao, formato.tiposFicheiro);
    criterios.push({
      estado: aceite ? "pass" : "fail",
      texto: aceite
        ? `Tipo de ficheiro: ${item.extensao} ✓`
        : `Tipo de ficheiro: ${item.extensao} — esperado ${formato.tiposFicheiro.join(", ")}`,
    });
  }

  // --- Dimensões ---
  let dimensaoEncontrada = null;
  if (formato.dimensoes && formato.dimensoes.length > 0) {
    if (item.largura && item.altura) {
      dimensaoEncontrada = formato.dimensoes.find((d) => d.largura === item.largura && d.altura === item.altura);
      if (dimensaoEncontrada) {
        criterios.push({ estado: "pass", texto: `Dimensões: ${item.largura}×${item.altura} px ✓` });
      } else {
        const opcoes = formato.dimensoes.map((d) => `${d.largura}×${d.altura}`).join(", ");
        criterios.push({
          estado: "fail",
          texto: `Dimensões: ${item.largura}×${item.altura} px — esperado uma de: ${opcoes} px`,
        });
      }
    } else {
      criterios.push({ estado: "neutro", texto: "Dimensões: não foi possível ler neste tipo de ficheiro" });
    }
  }

  // --- Peso ---
  const limitePeso = (dimensaoEncontrada && dimensaoEncontrada.pesoMaximoBytes) || formato.pesoMaximoBytes;
  if (limitePeso) {
    const dentro = item.tamanhoBytes <= limitePeso;
    criterios.push({
      estado: dentro ? "pass" : "fail",
      texto: dentro
        ? `Peso: ${formatarBytes(item.tamanhoBytes)} ✓ (máx. ${formatarBytes(limitePeso)})`
        : `Peso: ${formatarBytes(item.tamanhoBytes)} — máx. ${formatarBytes(limitePeso)}`,
    });
  }

  // --- Aspect ratio ---
  if (formato.aspectRatios && formato.aspectRatios.length > 0 && item.largura && item.altura) {
    const valorReal = item.largura / item.altura;
    const correspondeAlgum = formato.aspectRatios.some(
      (ar) => Math.abs(ar.valor - valorReal) / ar.valor <= TOLERANCIA_ASPECT_RATIO
    );
    const opcoes = formato.aspectRatios.map((ar) => `${ar.largura}:${ar.altura}`).join(" ou ");
    criterios.push({
      estado: correspondeAlgum ? "pass" : "fail",
      texto: correspondeAlgum
        ? `Aspect ratio: ${opcoes} ✓`
        : `Aspect ratio: ${valorReal.toFixed(2)}:1 — esperado ${opcoes}`,
    });
  }

  if (criterios.length === 0) {
    criterios.push({ estado: "neutro", texto: "Este formato não tem specs técnicas suficientes para verificação automática." });
  }

  const temFalha = criterios.some((c) => c.estado === "fail");
  const temPass = criterios.some((c) => c.estado === "pass");
  const veredito = temFalha ? "reprovado" : temPass ? "aprovado" : "indeterminado";

  return { veredito, criterios };
}

function verificarTudo() {
  let verificados = 0;
  itens.forEach((item) => {
    if (!item.formatoId) return;
    const formato = obterFormato(item.formatoId);
    if (!formato) return;
    item.resultado = validarItem(item, formato);
    verificados += 1;
  });
  if (verificados === 0) {
    mostrarToast("Atribui um formato a pelo menos um material antes de verificar.");
    return;
  }
  atualizarTudo();
}

/*
============================================
6. PESQUISA DE FORMATO (painel partilhado)
============================================
*/
function pesquisarFormatos(termo) {
  const alvo = termo.trim().toLowerCase();
  if (!alvo) return FORMATOS.slice(0, 40);
  return FORMATOS.filter((f) => {
    const texto = `${f.fornecedor} ${f.veiculo} ${f.formato}`.toLowerCase();
    return texto.includes(alvo);
  }).slice(0, 40);
}

function abrirPainelResultados(input, alvo) {
  alvoPainelAtivo = alvo;
  indiceAtivoPainel = -1;
  renderizarPainelResultados(pesquisarFormatos(input.value));

  const retangulo = input.getBoundingClientRect();
  painelResultados.style.left = `${retangulo.left + window.scrollX}px`;
  painelResultados.style.top = `${retangulo.bottom + window.scrollY + 4}px`;
  painelResultados.style.width = `${retangulo.width}px`;
  painelResultados.hidden = false;
}

function fecharPainelResultados() {
  painelResultados.hidden = true;
  alvoPainelAtivo = null;
  indiceAtivoPainel = -1;
}

function renderizarPainelResultados(resultados) {
  if (resultados.length === 0) {
    painelResultados.innerHTML = `<p class="painel-resultados-vazio">Sem formatos encontrados.</p>`;
    return;
  }
  painelResultados.innerHTML = resultados
    .map(
      (f, i) => `
      <button type="button" class="resultado-formato${i === indiceAtivoPainel ? " ativo" : ""}" data-formato-id="${f.id}">
        <strong>${f.fornecedor} — ${f.formato}</strong>
        <span>${f.meio} · ${f.dimensaoTexto || "sem dimensão definida"}</span>
      </button>`
    )
    .join("");
}

// Atribui manualmente um formato a um material — usado tanto na seleção
// individual como no botão "Aplicar a todos". Desliga-o de um eventual slot
// esperado anterior e tenta ligá-lo a um novo (ainda vazio) com o mesmo
// formato, para o relatório de entrega se manter coerente com a escolha.
function atribuirFormatoAoItem(item, formatoId) {
  if (item.esperadoId) {
    const esperadoAntigo = esperados.find((e) => e.id === item.esperadoId);
    if (esperadoAntigo) esperadoAntigo.itemIdAssociado = null;
    item.esperadoId = null;
  }
  item.formatoId = formatoId;
  item.resultado = null;

  const esperadoCorrespondente = esperados.find((e) => e.formatoId === formatoId && !e.itemIdAssociado);
  if (esperadoCorrespondente) {
    item.esperadoId = esperadoCorrespondente.id;
    esperadoCorrespondente.itemIdAssociado = item.id;
  }
}

function selecionarFormato(formatoId) {
  const formato = obterFormato(formatoId);
  if (!formato || !alvoPainelAtivo) return;

  if (alvoPainelAtivo.tipo === "lote") {
    formatoLoteId = formatoId;
    inputFormatoLote.value = rotuloFormato(formato);
    inputFormatoLote.classList.add("input-formato--selecionado");
    botaoAplicarLote.disabled = false;
  } else if (alvoPainelAtivo.tipo === "item") {
    const item = itens.find((i) => i.id === alvoPainelAtivo.itemId);
    if (item) {
      atribuirFormatoAoItem(item, formatoId);
      atualizarTudo();
    }
  } else if (alvoPainelAtivo.tipo === "esperado") {
    const esperado = { id: proximoIdEsperado++, formatoId, itemIdAssociado: null };
    esperados.push(esperado);
    inputFormatoEsperado.value = "";
    // Um novo slot pode corresponder a um material já carregado que ainda
    // não tinha sido identificado (ex.: a checklist foi criada depois do
    // upload da pasta) — tenta ligar aos materiais por atribuir.
    tentarAutoAssociar(itens.filter((i) => !i.formatoId));
    atualizarTudo();
  }
  fecharPainelResultados();
}

/*
============================================
7. RENDERIZAÇÃO
============================================
*/
function criarPreviewHtml(item) {
  if (item.aCarregar) return `<span>A carregar…</span>`;
  if (item.tipoMedia === "imagem" && item.urlObjeto) {
    return `<img src="${item.urlObjeto}" alt="">`;
  }
  if (item.tipoMedia === "video" && item.urlObjeto) {
    return `<video src="${item.urlObjeto}" muted></video>`;
  }
  return `<span>${item.extensao || "FICHEIRO"}</span>`;
}

function criarInfoHtml(item) {
  const etiquetas = [];
  if (item.largura && item.altura) etiquetas.push(`${item.largura}×${item.altura} px`);
  if (item.tipoMedia === "video" && item.duracaoSeg) etiquetas.push(formatarDuracao(item.duracaoSeg));
  etiquetas.push(formatarBytes(item.tamanhoBytes));
  if (item.extensao) etiquetas.push(item.extensao);
  return etiquetas.map((e) => `<span class="etiqueta-info">${e}</span>`).join("");
}

function criarResultadoHtml(item) {
  if (!item.resultado) return "";
  const { veredito, criterios } = item.resultado;
  const textoVeredito = veredito === "aprovado" ? "Aprovado" : veredito === "reprovado" ? "Reprovado" : "Não verificável";
  const criteriosHtml = criterios
    .map((c) => {
      const icone = c.estado === "pass" ? "✓" : c.estado === "fail" ? "✗" : "•";
      return `<li class="criterio criterio--${c.estado === "pass" ? "pass" : c.estado === "fail" ? "fail" : "neutro"}"><span class="criterio-icone">${icone}</span><span>${c.texto}</span></li>`;
    })
    .join("");
  return `
    <div class="item-material-resultado">
      <span class="badge-veredito badge-veredito--${veredito}">${textoVeredito}</span>
      <ul class="lista-criterios">${criteriosHtml}</ul>
    </div>`;
}

function criarLinhaHtml(item) {
  const formato = item.formatoId ? obterFormato(item.formatoId) : null;
  const valorInput = formato ? rotuloFormato(formato) : "";
  const classeVeredito = item.resultado ? ` item-material--${item.resultado.veredito === "aprovado" ? "aprovado" : item.resultado.veredito === "reprovado" ? "reprovado" : ""}` : "";

  return `
    <li class="item-material${classeVeredito}" data-item-id="${item.id}">
      <div class="item-material-preview">${criarPreviewHtml(item)}</div>
      <div class="item-material-corpo">
        <div class="item-material-topo">
          <span class="item-material-nome">${item.nome}</span>
          <button type="button" class="item-material-remover" data-acao="remover" aria-label="Remover material">&times;</button>
        </div>
        <div class="item-material-info">${criarInfoHtml(item)}</div>
        <div class="campo-seletor-formato campo-seletor-formato--item">
          <input type="text" class="input-formato${formato ? " input-formato--selecionado" : ""}" placeholder="Escolher formato para verificar…" autocomplete="off" data-alvo="item" value="${valorInput}">
        </div>
        ${criarResultadoHtml(item)}
      </div>
    </li>`;
}

function renderizarLista() {
  listaMateriais.innerHTML = itens.map(criarLinhaHtml).join("");
}

function atualizarBarraAcoes() {
  if (itens.length === 0) {
    barraAcoes.hidden = true;
    return;
  }
  barraAcoes.hidden = false;

  const verificados = itens.filter((i) => i.resultado);
  if (verificados.length === 0) {
    resumoVerificacao.textContent = `${itens.length} material${itens.length > 1 ? "is" : ""} por verificar`;
    return;
  }
  const aprovados = verificados.filter((i) => i.resultado.veredito === "aprovado").length;
  const reprovados = verificados.filter((i) => i.resultado.veredito === "reprovado").length;
  resumoVerificacao.innerHTML = `<span class="contagem-aprovados">${aprovados} aprovado${aprovados !== 1 ? "s" : ""}</span> · <span class="contagem-reprovados">${reprovados} reprovado${reprovados !== 1 ? "s" : ""}</span> de ${itens.length}`;
}

/*
============================================
8.0 IMPORTAR PEDIDO DE SPECS (.xlsx exportado pelo CSBuilder)
O CSBuilder exporta uma folha por meio (Digital/OOH/TV/Rádio/Cinema/
Imprensa), com secções por objetivo (Awareness/Consideration/
Conversion) e uma tabela por secção — colunas variam por meio (ver
COLUNAS_POR_MEIO_EXCEL_PEDIDO, cópia da mesma estrutura usada para
escrever o ficheiro). Em vez de montar a checklist de formatos
esperados à mão, lemos esse ficheiro e extraímos quais formatos foram
pedidos, casando Plataforma+Formato com a nossa base de specs.
============================================
*/

// Mesma lista de colunas, por meio, que o CSBuilder usa para escrever o
// Excel (a coluna fixa "#" vem sempre primeiro, antes destas). Só
// precisamos de saber em que posição ficam "plataforma" e "formato" —
// mas mantém-se a lista completa para o mapeamento ficar claro e fácil
// de comparar com o CSBuilder caso a estrutura mude no futuro.
const COLUNAS_POR_MEIO_EXCEL_PEDIDO = {
  "Digital": ["canal", "plataforma", "formato", "tema", "dimensao", "aspectRatio", "peso", "tipoFicheiro", "copies", "observacoes", "link", "dataInicioCampanha", "dataEntrega"],
  "OOH": ["plataforma", "formato", "temaCriativo", "dimensao", "aspectRatio", "tipoFicheiro", "entregaAF", "entregaMorada", "moradaEntregaMupi", "observacoes", "dataInicioCampanha", "dataEntrega"],
  "TV": ["plataforma", "formato", "secundagem", "temaCriativo", "dimensao", "aspectRatio", "tipoFicheiro", "entregaTV", "observacoes", "dataInicioCampanha", "dataEntrega"],
  "Rádio": ["plataforma", "formato", "secundagem", "temaCriativo", "tipoFicheiro", "observacoes", "dataInicioCampanha", "dataEntrega"],
  "Cinema": ["plataforma", "formato", "dimensao", "aspectRatio", "tipoFicheiro", "observacoes", "dataInicioCampanha", "dataEntrega"],
  "Imprensa": ["plataforma", "formato", "dimensao", "tipoFicheiro", "observacoes", "dataInicioCampanha", "dataEntrega"],
};

function normalizarTextoComparavel(texto) {
  return removerAcentosParaComparar(String(texto || ""))
    .trim()
    .toLowerCase();
}

function removerAcentosParaComparar(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// O valor de uma célula do ExcelJS nem sempre é uma string simples — uma
// célula com hyperlink, por exemplo, vem como { text, hyperlink }.
function textoCelulaExcel(celula) {
  const valor = celula.value;
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object") {
    if (valor.richText) return valor.richText.map((parte) => parte.text).join("");
    if (valor.text !== undefined) return String(valor.text);
    if (valor.result !== undefined) return String(valor.result);
    return "";
  }
  return String(valor).trim();
}

// Dado o nome de uma folha do Excel, tenta reconhecer a que meio
// corresponde (comparação sem acentos/maiúsculas, porque o nome da folha
// pode ter sido exportado noutra língua — ver CHAVE_TRADUCAO_MEIO no
// CSBuilder). Devolve null se não reconhecer.
function meioDoNomeFolha(nomeFolha) {
  const alvo = normalizarTextoComparavel(nomeFolha);
  const chave = Object.keys(COLUNAS_POR_MEIO_EXCEL_PEDIDO).find((k) => normalizarTextoComparavel(k) === alvo);
  return chave || null;
}

// Varre uma folha já reconhecida (colunasChaves conhecidas) e devolve uma
// entrada {plataforma, formato} por cada linha numerada ("#" preenchido
// com 1, 2, 3...) — essa é sempre a primeira linha de cada
// formato pedido, mesmo quando esse formato se espalha por mais do que
// uma linha (vários temas): as linhas de continuação ficam com a coluna
// "#" em branco e são ignoradas aqui.
function extrairPedidosDaFolha(folha, colunasChaves) {
  const indiceFormato = colunasChaves.indexOf("formato") + 2;
  const indicePlataforma = colunasChaves.indexOf("plataforma") + 2;
  if (indiceFormato < 2 || indicePlataforma < 2) return [];

  const pedidos = [];
  folha.eachRow((linha) => {
    const valorPrimeiraColuna = linha.getCell(1).value;
    const ehLinhaNumerada = typeof valorPrimeiraColuna === "number" && Number.isInteger(valorPrimeiraColuna) && valorPrimeiraColuna > 0;
    if (!ehLinhaNumerada) return;

    const formato = textoCelulaExcel(linha.getCell(indiceFormato));
    const plataforma = textoCelulaExcel(linha.getCell(indicePlataforma));
    if (formato && plataforma) {
      pedidos.push({ plataforma, formato });
    }
  });
  return pedidos;
}

// Casa um pedido (texto solto do Excel) com um formato concreto da nossa
// base — por Veículo + Formato, sem olhar ao Meio (o nome da folha já
// filtra isso na prática, e exigir correspondência exata de Meio só
// rejeitaria casos legítimos se o mapeamento de meio falhar). Devolve o
// formato quando há exatamente uma correspondência; null em caso de
// ambiguidade ou de não encontrar nada — para nunca associar "à sorte".
function casarPedidoComFormato(pedido) {
  const alvoVeiculo = normalizarTextoComparavel(pedido.plataforma);
  const alvoFormato = normalizarTextoComparavel(pedido.formato);
  const candidatos = FORMATOS.filter(
    (f) => normalizarTextoComparavel(f.veiculo) === alvoVeiculo && normalizarTextoComparavel(f.formato) === alvoFormato
  );
  return candidatos.length === 1 ? candidatos[0] : null;
}

async function processarPedidoExcel(file) {
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch (erro) {
    mostrarToast("Não foi possível ler este ficheiro — confirma que é um .xlsx exportado pelo CSBuilder.");
    console.error(erro);
    return;
  }

  const todosPedidos = [];
  const folhasIgnoradas = [];
  workbook.worksheets.forEach((folha) => {
    const meio = meioDoNomeFolha(folha.name);
    if (!meio) {
      folhasIgnoradas.push(folha.name);
      return;
    }
    const colunasChaves = COLUNAS_POR_MEIO_EXCEL_PEDIDO[meio];
    todosPedidos.push(...extrairPedidosDaFolha(folha, colunasChaves));
  });

  if (todosPedidos.length === 0) {
    mostrarToast("Não foi possível encontrar formatos pedidos neste ficheiro — confirma que é o Excel exportado pelo CSBuilder.");
    return;
  }

  let adicionados = 0;
  const naoReconhecidos = [];
  todosPedidos.forEach((pedido) => {
    const formato = casarPedidoComFormato(pedido);
    if (formato) {
      esperados.push({ id: proximoIdEsperado++, formatoId: formato.id, itemIdAssociado: null });
      adicionados += 1;
    } else {
      naoReconhecidos.push(`${pedido.plataforma} · ${pedido.formato}`);
    }
  });

  tentarAutoAssociar(itens.filter((i) => !i.formatoId));
  atualizarTudo();

  const primeiraFolha = workbook.worksheets.find((f) => meioDoNomeFolha(f.name));
  const cliente = primeiraFolha ? textoCelulaExcel(primeiraFolha.getCell("F3")) : "";
  const campanha = primeiraFolha ? textoCelulaExcel(primeiraFolha.getCell("F4")) : "";
  pedidoResumo.textContent = cliente || campanha ? `Pedido: ${cliente}${cliente && campanha ? " — " : ""}${campanha}` : "";

  let mensagem = `${adicionados} formato${adicionados !== 1 ? "s" : ""} adicionado${adicionados !== 1 ? "s" : ""} à checklist a partir do pedido.`;
  if (naoReconhecidos.length > 0) {
    mensagem += ` ${naoReconhecidos.length} não reconhecido${naoReconhecidos.length !== 1 ? "s" : ""} (${naoReconhecidos.slice(0, 3).join("; ")}${naoReconhecidos.length > 3 ? "…" : ""}) — adiciona-os manualmente na pesquisa abaixo.`;
  }
  mostrarToast(mensagem);
}

botaoImportarPedido.addEventListener("click", () => inputPedidoExcel.click());

inputPedidoExcel.addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  if (file) processarPedidoExcel(file);
  inputPedidoExcel.value = "";
});

/*
============================================
8.1 CHECKLIST DE FORMATOS ESPERADOS
============================================
*/
function criarLinhaEsperadoHtml(esperado, indice) {
  const formato = obterFormato(esperado.formatoId);
  return `
    <li class="linha-esperado" data-esperado-id="${esperado.id}">
      <span class="linha-esperado-numero">${indice + 1}.</span>
      <span class="linha-esperado-nome">${formato ? rotuloFormato(formato) : "Formato desconhecido"}</span>
      <button type="button" class="item-material-remover" data-acao="remover-esperado" aria-label="Remover da lista de formatos esperados">&times;</button>
    </li>`;
}

function renderizarEsperados() {
  listaEsperados.innerHTML = esperados.map(criarLinhaEsperadoHtml).join("");
}

function removerEsperado(id) {
  const esperado = esperados.find((e) => e.id === id);
  if (esperado && esperado.itemIdAssociado) {
    const item = itens.find((i) => i.id === esperado.itemIdAssociado);
    if (item) item.esperadoId = null;
  }
  esperados = esperados.filter((e) => e.id !== id);
  atualizarTudo();
}

/*
============================================
8.2 RELATÓRIO DE ENTREGA
Compara a checklist de formatos esperados com o que foi
efetivamente carregado (e verificado) — mostra o que está
aprovado, o que foi entregue mas reprovou, e o que falta.
============================================
*/
function criarLinhaRelatorioEsperado(esperado) {
  const formato = obterFormato(esperado.formatoId);
  const item = esperado.itemIdAssociado ? itens.find((i) => i.id === esperado.itemIdAssociado) : null;

  let estado = "falta";
  let texto = "Em falta";
  let detalhesHtml = "";

  if (item) {
    if (!item.resultado) {
      estado = "porverificar";
      texto = "Entregue — por verificar";
    } else if (item.resultado.veredito === "aprovado") {
      estado = "aprovado";
      texto = "Entregue e aprovado";
    } else if (item.resultado.veredito === "reprovado") {
      estado = "reprovado";
      texto = "Entregue mas reprovado";
      const falhas = item.resultado.criterios.filter((c) => c.estado === "fail");
      detalhesHtml = `<ul class="lista-criterios">${falhas
        .map((c) => `<li class="criterio criterio--fail"><span class="criterio-icone">✗</span><span>${c.texto}</span></li>`)
        .join("")}</ul>`;
    } else {
      estado = "indeterminado";
      texto = "Entregue — não verificável automaticamente";
    }
  }

  const classeBadge = estado === "porverificar" ? "indeterminado" : estado;
  return `
    <li class="linha-relatorio linha-relatorio--${estado}">
      <div class="linha-relatorio-topo">
        <span class="badge-veredito badge-veredito--${classeBadge}">${texto}</span>
        <span class="linha-relatorio-formato">${formato ? rotuloFormato(formato) : ""}</span>
        ${item ? `<span class="linha-relatorio-ficheiro">${item.nome}</span>` : ""}
      </div>
      ${detalhesHtml}
    </li>`;
}

function criarLinhaRelatorioExtra(item) {
  return `
    <li class="linha-relatorio">
      <div class="linha-relatorio-topo">
        <span class="badge-veredito badge-veredito--indeterminado">Extra</span>
        <span class="linha-relatorio-ficheiro">${item.nome}</span>
        <span class="linha-relatorio-formato">não corresponde a nenhum formato esperado</span>
      </div>
    </li>`;
}

function renderizarRelatorio() {
  if (esperados.length === 0) {
    secaoRelatorio.hidden = true;
    return;
  }
  secaoRelatorio.hidden = false;

  const extras = itens.filter((item) => !item.esperadoId);
  listaRelatorio.innerHTML =
    esperados.map(criarLinhaRelatorioEsperado).join("") + extras.map(criarLinhaRelatorioExtra).join("");
}

function atualizarTudo() {
  renderizarLista();
  renderizarEsperados();
  renderizarRelatorio();
  atualizarBarraAcoes();
}

/*
============================================
8. EVENTOS
============================================
*/
botaoEscolherFicheiros.addEventListener("click", () => inputFicheiros.click());

inputFicheiros.addEventListener("change", (ev) => {
  adicionarFicheiros(ev.target.files);
  inputFicheiros.value = "";
});

botaoEscolherPasta.addEventListener("click", () => inputPasta.click());

inputPasta.addEventListener("change", (ev) => {
  adicionarFicheiros(ev.target.files);
  inputPasta.value = "";
});

["dragenter", "dragover"].forEach((evento) => {
  zonaUpload.addEventListener(evento, (ev) => {
    ev.preventDefault();
    zonaUpload.classList.add("zona-upload--ativa");
  });
});

["dragleave", "drop"].forEach((evento) => {
  zonaUpload.addEventListener(evento, (ev) => {
    ev.preventDefault();
    zonaUpload.classList.remove("zona-upload--ativa");
  });
});

zonaUpload.addEventListener("drop", async (ev) => {
  if (!ev.dataTransfer) return;
  // Usa a File System API (via webkitGetAsEntry) para também aceitar uma
  // pasta inteira arrastada — não só ficheiros soltos.
  const entradas = await obterFicheirosDeDrop(ev.dataTransfer);
  adicionarEntradas(entradas);
});

botaoVerificarTudo.addEventListener("click", verificarTudo);
botaoLimparTudo.addEventListener("click", limparTudo);

botaoAplicarLote.addEventListener("click", () => {
  if (!formatoLoteId) return;
  itens.forEach((item) => atribuirFormatoAoItem(item, formatoLoteId));
  atualizarTudo();
  mostrarToast("Formato aplicado a todos os materiais.");
});

// Pesquisa + navegação por teclado: delega tanto no input do lote/checklist
// como nos inputs (dinâmicos) de cada item, através de um único listener.
function alvoDoInput(inputEl) {
  const alvoTipo = inputEl.dataset.alvo;
  if (alvoTipo === "lote") return { tipo: "lote" };
  if (alvoTipo === "esperado") return { tipo: "esperado" };
  return { tipo: "item", itemId: Number(inputEl.closest("[data-item-id]").dataset.itemId) };
}

document.addEventListener("input", (ev) => {
  if (!ev.target.classList.contains("input-formato")) return;
  const alvo = alvoDoInput(ev.target);
  ev.target.classList.remove("input-formato--selecionado");
  if (alvo.tipo === "lote") {
    formatoLoteId = null;
    botaoAplicarLote.disabled = true;
  } else if (alvo.tipo === "item") {
    const item = itens.find((i) => i.id === alvo.itemId);
    if (item) {
      if (item.esperadoId) {
        const esperadoAntigo = esperados.find((e) => e.id === item.esperadoId);
        if (esperadoAntigo) esperadoAntigo.itemIdAssociado = null;
        item.esperadoId = null;
      }
      item.formatoId = null;
      item.resultado = null;
    }
  }
  // alvo "esperado": o input serve só para adicionar novas entradas —
  // não há seleção a limpar.
  abrirPainelResultados(ev.target, alvo);
});

document.addEventListener("focusin", (ev) => {
  if (!ev.target.classList.contains("input-formato")) return;
  abrirPainelResultados(ev.target, alvoDoInput(ev.target));
});

document.addEventListener("keydown", (ev) => {
  if (painelResultados.hidden) return;
  const botoes = Array.from(painelResultados.querySelectorAll(".resultado-formato"));
  if (botoes.length === 0) return;

  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    indiceAtivoPainel = Math.min(indiceAtivoPainel + 1, botoes.length - 1);
    botoes.forEach((b, i) => b.classList.toggle("ativo", i === indiceAtivoPainel));
    botoes[indiceAtivoPainel].scrollIntoView({ block: "nearest" });
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    indiceAtivoPainel = Math.max(indiceAtivoPainel - 1, 0);
    botoes.forEach((b, i) => b.classList.toggle("ativo", i === indiceAtivoPainel));
    botoes[indiceAtivoPainel].scrollIntoView({ block: "nearest" });
  } else if (ev.key === "Enter" && indiceAtivoPainel >= 0) {
    ev.preventDefault();
    selecionarFormato(botoes[indiceAtivoPainel].dataset.formatoId);
  } else if (ev.key === "Escape") {
    fecharPainelResultados();
  }
});

painelResultados.addEventListener("click", (ev) => {
  const botao = ev.target.closest(".resultado-formato");
  if (botao) selecionarFormato(botao.dataset.formatoId);
});

document.addEventListener("click", (ev) => {
  if (ev.target.closest(".input-formato") || ev.target.closest(".painel-resultados")) return;
  fecharPainelResultados();
});

listaMateriais.addEventListener("click", (ev) => {
  const botaoRemover = ev.target.closest('[data-acao="remover"]');
  if (botaoRemover) {
    const id = Number(botaoRemover.closest("[data-item-id]").dataset.itemId);
    removerItem(id);
  }
});

listaEsperados.addEventListener("click", (ev) => {
  const botaoRemover = ev.target.closest('[data-acao="remover-esperado"]');
  if (botaoRemover) {
    const id = Number(botaoRemover.closest("[data-esperado-id]").dataset.esperadoId);
    removerEsperado(id);
  }
});

window.addEventListener("resize", () => {
  if (!painelResultados.hidden) fecharPainelResultados();
});

/*
============================================
9. ARRANQUE
============================================
*/
carregarSpecs();
