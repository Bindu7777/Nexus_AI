import targetsFile from "../../config/targets.json";

export type TargetRecord = {
  id: string;
  kind: "sandbox-catalog" | "astronomy-shop";
  implemented: boolean;
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  baseUrl?: string;
  note: string;
};

const file = targetsFile as {
  active: string;
  targets: TargetRecord[];
};

export function listTargets() {
  return file.targets;
}

export function activeTargetId() {
  return process.env.NEXUS_TARGET || file.active;
}

export function resolveTarget(id = activeTargetId()) {
  const target = file.targets.find((item) => item.id === id);
  if (!target) {
    return { ok: false as const, message: `Unknown target "${id}".` };
  }
  if (!target.implemented) {
    return {
      ok: false as const,
      target,
      message: `${target.id} is not implemented. ${target.note}`,
    };
  }
  const baseUrl =
    (target.baseUrlEnv ? process.env[target.baseUrlEnv] : undefined) ||
    target.defaultBaseUrl ||
    target.baseUrl ||
    "";
  if (!baseUrl) {
    return { ok: false as const, target, message: `${target.id} has no base URL.` };
  }
  return { ok: true as const, target, baseUrl };
}
