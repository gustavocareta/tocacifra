/** Sem conexao com o servidor: o app guarda a edicao na fila e tenta de novo depois. */
export class OfflineError extends Error {}
