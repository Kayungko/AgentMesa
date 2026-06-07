import type {
  MesaActor,
  MesaPolicyDecision,
  MesaPolicyEngine,
} from './types.js';

export class AllowAllMesaPolicyEngine implements MesaPolicyEngine {
  can(_actor: MesaActor, _action: string, _resource: string): MesaPolicyDecision {
    return { allowed: true };
  }
}
