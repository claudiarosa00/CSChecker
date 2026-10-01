# CSChecker — Verificador de Materiais Criativos

Ferramenta irmã do [CSBuilder](https://github.com/claudiarosa00/CSBuilder_Market): em vez de montar o pedido de formatos, verifica se os materiais já produzidos cumprem as specs técnicas de cada formato (dimensões, peso, tipo de ficheiro, aspect ratio) — antes de os enviar ao publisher.

Usa a mesma base de formatos do CSBuilder (`data/base-formatos.xlsx`), por isso qualquer formato que exista lá também está disponível aqui para verificação.

## Como usar

1. **Carrega os materiais** — arrasta vários ficheiros para a zona de upload, ou escolhe-os de uma vez (imagens, vídeos, HTML5, PDF).
2. **Atribui um formato a cada um** — pesquisa por fornecedor ou nome do formato no campo de cada material. Se vários materiais forem para o mesmo formato (ex.: versão desktop + mobile de um Billboard), usa o seletor "Aplicar um formato a todos os materiais" no topo, em vez de repetir a pesquisa.
3. **Verificar todos** — a ferramenta lê automaticamente a dimensão real, o peso e o tipo de cada ficheiro e compara com a spec do formato escolhido. Cada material fica com um veredito (Aprovado / Reprovado / Não verificável) e a lista detalhada do que passou ou falhou.

Nada é enviado para fora do browser — a leitura das dimensões/peso dos ficheiros é feita localmente, no próprio navegador.

## O que é verificado

- **Dimensões** — a imagem/vídeo tem de corresponder exatamente a uma das dimensões permitidas pelo formato (alguns formatos aceitam mais do que uma, ex. "970x250, 320x10").
- **Peso** — tamanho do ficheiro dentro do limite definido para o formato (ou para a dimensão específica usada, quando o limite varia por dimensão).
- **Tipo de ficheiro** — extensão do ficheiro dentro dos tipos aceites (JPG/PNG/GIF/HTML/MP4, etc. — `.jpeg` é aceite onde o formato pede `.jpg`, e vice-versa).
- **Aspect ratio** — quando o formato define um rácio (ex. "1:2"), a proporção real da imagem/vídeo é comparada com margem de 2% para arredondamentos.

Quando a base não tem informação suficiente para um destes critérios (ex. um formato de OOH sem dimensão em pixels), esse critério aparece marcado como "não verificável automaticamente" em vez de reprovado — a ferramenta nunca inventa uma regra que não está na base.

## Estrutura

| Ficheiro | Função |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Visual — mesma paleta e família do CSBuilder (azul claro, neutros) |
| `app.js` | Leitura de ficheiros, pesquisa de formatos e lógica de verificação |
| `data/base-formatos.xlsx` | Base de formatos original (mesma fonte do CSBuilder) |
| `data/specs.json` | Gerado a partir do Excel acima — specs já estruturadas (dimensões, peso em bytes, tipos, aspect ratio) para o app.js poder comparar sem ter de interpretar texto livre no browser |
| `scripts/gerar_specs_json.py` | Script que gera `data/specs.json` a partir do Excel — corre-se sempre que a base de formatos for atualizada |

Para atualizar a base de formatos: substitui `data/base-formatos.xlsx` e corre `python3 scripts/gerar_specs_json.py` para regenerar o `specs.json`.
