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

const zonaUpload = document.getElementById("zonaUpload");
const inputFicheiros = document.getElementById("inputFicheiros");
const botaoEscolherFicheiros = document.getElementById("botaoEscolherFicheiros");
const listaMateriais = document.getElementById("listaMateriais");
const barraAcoes = document.getElementById("barraAcoes");
const resumoVerificacao = document.getElementById("resumoVerificacao");
const botaoVerificarTudo = document.getElementById("botaoVerificarTudo");
const botaoLimparTudo = document.getElementById("botaoLimparTudo");
const inputFormatoLote = document.getElementById("inputFormatoLote");
const botaoAplicarLote = document.getElementById("botaoAplicarLote");
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
4. ADICIONAR / REMOVER MATERIAIS
============================================
*/
async function adicionarFicheiros(fileList) {
  const ficheiros = Array.from(fileList);
  if (ficheiros.length === 0) return;

  for (const file of ficheiros) {
    const item = {
      id: proximoIdItem++,
      file,
      nome: file.name,
      tamanhoBytes: file.size,
      extensao: extensaoDoFicheiro(file.name),
      tipoMedia: "outro",
      largura: null,
      altura: null,
      duracaoSeg: null,
      urlObjeto: null,
      formatoId: null,
      resultado: null,
      aCarregar: true,
    };
    itens.push(item);
  }

  renderizarLista();
  atualizarBarraAcoes();

  // Lê metadados em paralelo, cada item re-renderiza assim que fica pronto.
  await Promise.all(
    itens
      .filter((item) => item.aCarregar)
      .map(async (item) => {
        const metadados = await lerMetadados(item.file);
        Object.assign(item, metadados, { aCarregar: false });
        atualizarLinhaItem(item.id);
      })
  );
}

function removerItem(id) {
  const item = itens.find((i) => i.id === id);
  if (item && item.urlObjeto) URL.revokeObjectURL(item.urlObjeto);
  itens = itens.filter((i) => i.id !== id);
  renderizarLista();
  atualizarBarraAcoes();
}

function limparTudo() {
  itens.forEach((item) => {
    if (item.urlObjeto) URL.revokeObjectURL(item.urlObjeto);
  });
  itens = [];
  renderizarLista();
  atualizarBarraAcoes();
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
    const formato = FORMATOS.find((f) => f.id === item.formatoId);
    if (!formato) return;
    item.resultado = validarItem(item, formato);
    verificados += 1;
  });
  if (verificados === 0) {
    mostrarToast("Atribui um formato a pelo menos um material antes de verificar.");
    return;
  }
  renderizarLista();
  atualizarBarraAcoes();
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

function selecionarFormato(formatoId) {
  const formato = FORMATOS.find((f) => f.id === formatoId);
  if (!formato || !alvoPainelAtivo) return;

  if (alvoPainelAtivo.tipo === "lote") {
    formatoLoteId = formatoId;
    inputFormatoLote.value = rotuloFormato(formato);
    inputFormatoLote.classList.add("input-formato--selecionado");
    botaoAplicarLote.disabled = false;
  } else if (alvoPainelAtivo.tipo === "item") {
    const item = itens.find((i) => i.id === alvoPainelAtivo.itemId);
    if (item) {
      item.formatoId = formatoId;
      item.resultado = null;
      atualizarLinhaItem(item.id);
      atualizarBarraAcoes();
    }
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
  const formato = item.formatoId ? FORMATOS.find((f) => f.id === item.formatoId) : null;
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

function atualizarLinhaItem(itemId) {
  const item = itens.find((i) => i.id === itemId);
  const linha = listaMateriais.querySelector(`[data-item-id="${itemId}"]`);
  if (!item || !linha) return;
  linha.outerHTML = criarLinhaHtml(item);
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
8. EVENTOS
============================================
*/
botaoEscolherFicheiros.addEventListener("click", () => inputFicheiros.click());

inputFicheiros.addEventListener("change", (ev) => {
  adicionarFicheiros(ev.target.files);
  inputFicheiros.value = "";
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

zonaUpload.addEventListener("drop", (ev) => {
  if (ev.dataTransfer && ev.dataTransfer.files) {
    adicionarFicheiros(ev.dataTransfer.files);
  }
});

botaoVerificarTudo.addEventListener("click", verificarTudo);
botaoLimparTudo.addEventListener("click", limparTudo);

botaoAplicarLote.addEventListener("click", () => {
  if (!formatoLoteId) return;
  itens.forEach((item) => {
    item.formatoId = formatoLoteId;
    item.resultado = null;
  });
  renderizarLista();
  atualizarBarraAcoes();
  mostrarToast("Formato aplicado a todos os materiais.");
});

// Pesquisa + navegação por teclado: delega tanto no input do lote como nos
// inputs (dinâmicos) de cada item, através de um único listener no documento.
document.addEventListener("input", (ev) => {
  if (!ev.target.classList.contains("input-formato")) return;
  const alvoTipo = ev.target.dataset.alvo;
  const alvo =
    alvoTipo === "lote"
      ? { tipo: "lote" }
      : { tipo: "item", itemId: Number(ev.target.closest("[data-item-id]").dataset.itemId) };
  ev.target.classList.remove("input-formato--selecionado");
  if (alvo.tipo === "lote") {
    formatoLoteId = null;
    botaoAplicarLote.disabled = true;
  } else {
    const item = itens.find((i) => i.id === alvo.itemId);
    if (item) {
      item.formatoId = null;
      item.resultado = null;
    }
  }
  abrirPainelResultados(ev.target, alvo);
});

document.addEventListener("focusin", (ev) => {
  if (!ev.target.classList.contains("input-formato")) return;
  const alvoTipo = ev.target.dataset.alvo;
  const alvo =
    alvoTipo === "lote"
      ? { tipo: "lote" }
      : { tipo: "item", itemId: Number(ev.target.closest("[data-item-id]").dataset.itemId) };
  abrirPainelResultados(ev.target, alvo);
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

window.addEventListener("resize", () => {
  if (!painelResultados.hidden) fecharPainelResultados();
});

/*
============================================
9. ARRANQUE
============================================
*/
carregarSpecs();
