// Minimal typing for the client `slots` service. Its runtime Service wrapper
// is not published with types in 0.2.2-rc.1; registration itself is typed by
// SlotCore.register against the SlotMap that each seat package augments.
import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotCore & {
      /** Run `register` once the named seat is declared; returns a disposer. */
      inject(name: string, register: () => () => void): () => void
    }
  }
}
