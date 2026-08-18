/* dsh-unidoc — host half type declarations (minimal, for package consumers) */
export const name: 'unidoc'
export const inject: string[]
export function apply(ctx: any, config?: { enabled?: boolean; announceToAgent?: boolean; rpcPath?: string }): void
