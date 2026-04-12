// =============================================================================
//  ✏️  CONFIGURAÇÕES — EDITE AQUI QUANDO NECESSÁRIO
//  A lógica do sistema fica em js/app.js — não precisa mexer lá.
// =============================================================================

const CONFIG = {

  // ══════════════════════════════════════════════════════════════════════════
  // 1. URL DA PLANILHA (Google Sheets publicado como CSV)
  //    Como publicar: Arquivo → Compartilhar → Publicar na Web → CSV → Copiar link
  // ══════════════════════════════════════════════════════════════════════════
  CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQI6auY_9xHSJGEj2yjUXBCGyx3K9acP3qRApIm6EqTuXw6rtd6BArAH12OAJx8HtRqvpbDsiawgbc2/pub?gid=936830313&single=true&output=csv",

  // ══════════════════════════════════════════════════════════════════════════
  // 2. INTERVALOS DE ATUALIZAÇÃO (em milissegundos)
  //    60000  =  1 minuto
  //    30000  =  30 segundos
  // ══════════════════════════════════════════════════════════════════════════
  REFRESH_MS: 60 * 1000,   // intervalo entre atualizações automáticas
  RETRY_MS:   10 * 1000,   // intervalo ao tentar novamente após erro
  MAX_RETRY:  5,            // número máximo de tentativas seguidas

  // ══════════════════════════════════════════════════════════════════════════
  // 3. DESTINOS EXCLUÍDOS DAS ESTATÍSTICAS DE EQUIDADE
  //    Adicione aqui destinos que não devem contar no índice de equidade
  // ══════════════════════════════════════════════════════════════════════════
  SKIP: [
    "FERIAS", "RECESSO", "RURAL", "HEMODIALISE",
    "MALOTE", "DISPONIVEL", "TRANSITO", "TRÂNSITO", "CANCELADA"
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DESTINOS EXCLUÍDOS DOS KPIs DA ESCALA DO DIA
  // ══════════════════════════════════════════════════════════════════════════
  SKIP_KPI: [
    "RURAL", "HEMODIALISE", "MALOTE",
    "DISPONIVEL", "TRANSITO", "TRÂNSITO"
  ],

  // ══════════════════════════════════════════════════════════════════════════
  // 5. PALETA DE CORES DOS MOTORISTAS (na ordem de aparição)
  // ══════════════════════════════════════════════════════════════════════════
  COLORS: [
    "#00d4ff", "#2ecc8f", "#ffc14d", "#9b7fff",
    "#ff8c42", "#e85555", "#f06292", "#4dd0e1",
    "#a5d6a7", "#ffb74d", "#ce93d8", "#80cbc4"
  ],
};
