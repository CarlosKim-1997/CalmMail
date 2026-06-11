/**
 * Hardware capability analysis for local AI.
 *
 * Design rule from the brief: present the result in plain language. We never
 * surface tokens-per-second, quantization formats, GGUF, RAM bandwidth, or
 * any other ML jargon to the user. The verdict is one of three words.
 */

import si from 'systeminformation';
import type { CachedHardwareCapability, HardwareCapability } from '@shared/types';
import { hardwareCapabilityRepo } from '@main/modules/persistence/repositories/hardwareCapabilityRepo';

export function getCachedHardwareCapability(): CachedHardwareCapability | null {
  return hardwareCapabilityRepo.get();
}

export async function analyzeHardware(): Promise<HardwareCapability> {
  const [mem, cpu, graphics] = await Promise.all([
    si.mem(),
    si.cpu(),
    si.graphics(),
  ]);

  const totalRamGb = round(mem.total / 1024 / 1024 / 1024);
  const freeRamGb = round(mem.available / 1024 / 1024 / 1024);
  const cpuCores = cpu.physicalCores || cpu.cores || 0;
  const cpuBrand = `${cpu.manufacturer ?? ''} ${cpu.brand ?? ''}`.trim() || 'Unknown CPU';

  const gpus = graphics.controllers ?? [];
  const dGpu = gpus.find((g) => (g.vram ?? 0) >= 1024);
  const hasGpu = !!dGpu;
  const gpuVramGb = dGpu?.vram != null ? round(dGpu.vram / 1024) : null;

  const { verdict, verdictMessage } = decideVerdict({
    totalRamGb,
    freeRamGb,
    cpuCores,
    hasGpu,
    gpuVramGb,
  });

  const capability: HardwareCapability = {
    totalRamGb,
    freeRamGb,
    cpuCores,
    cpuBrand,
    hasGpu,
    gpuVramGb,
    verdict,
    verdictMessage,
  };

  hardwareCapabilityRepo.set(capability, Date.now());
  return capability;
}

function decideVerdict(c: {
  totalRamGb: number;
  freeRamGb: number;
  cpuCores: number;
  hasGpu: boolean;
  gpuVramGb: number | null;
}): { verdict: HardwareCapability['verdict']; verdictMessage: string } {
  if (c.totalRamGb < 8 || c.cpuCores < 4) {
    return {
      verdict: 'not_recommended',
      verdictMessage:
        'On-device AI is not recommended on this PC. Cloud mode will feel much smoother.',
    };
  }
  const ramComfortable = c.totalRamGb >= 16 && c.freeRamGb >= 6;
  const gpuComfortable = c.hasGpu && (c.gpuVramGb ?? 0) >= 6;
  if (ramComfortable && (gpuComfortable || c.cpuCores >= 8)) {
    return {
      verdict: 'comfortable',
      verdictMessage:
        'Your PC can comfortably run lightweight on-device AI for briefings.',
    };
  }
  return {
    verdict: 'limited',
    verdictMessage:
      'On-device AI will work, but briefings may take noticeably longer than cloud mode.',
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
