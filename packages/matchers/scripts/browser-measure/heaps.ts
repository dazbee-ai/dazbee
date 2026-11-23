// CanvasKit's and ONNX Runtime's WebAssembly memories where the matcher runs, a worker or the page, told apart by
// the compiled module each is instantiated from, so the measurement reads each heap on its own (a matcher answer
// tells only their sum and the faces read).

/** The modules a matcher instantiates. */
export type HeapName = 'canvasKit' | 'onnxRuntime'

/** Each heap's bytes now, for those instantiated. */
export type Heaps = Partial<Record<HeapName, number>>

/**
 * Watches `WebAssembly.instantiate` for good from now on: a module `know` names keeps the memory its instance is
 * given or makes. Install it before the matcher loads; the matcher's own swaps call through it.
 */
export function watchHeaps(): { know(module: WebAssembly.Module, name: HeapName): void; read(): Heaps } {
  const names = new Map<WebAssembly.Module, HeapName>()
  const memories = new Map<HeapName, WebAssembly.Memory>()
  const { instantiate } = WebAssembly
  WebAssembly.instantiate = (async (source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) => {
    const made = await instantiate(source as BufferSource, imports)
    const name = source instanceof WebAssembly.Module ? names.get(source) : undefined
    if (name) {
      const instance: WebAssembly.Instance = made instanceof WebAssembly.Instance ? made : made.instance
      const given = Object.values(imports ?? {}).flatMap((module) => Object.values(module))
      const memory = [...given, ...Object.values(instance.exports)].find((value) => value instanceof WebAssembly.Memory)
      if (memory) memories.set(name, memory)
    }
    return made
  }) as typeof instantiate
  return {
    know: (module, name) => names.set(module, name),
    read: () => Object.fromEntries([...memories].map(([name, memory]) => [name, memory.buffer.byteLength])),
  }
}
