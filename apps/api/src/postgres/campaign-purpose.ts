import type { PoolClient } from 'pg';

import {
  campaignPurposes, normalizeTimeWindows, type CampaignPurposeSettings, type TimeWindow,
} from '../campaign-purpose-rules.js';
import type { CampaignPurposeSummary } from '../real-world-contract.js';

// campaign_purposes 행을 공개/관리자 응답용 jsonb 한 칸으로 만든다. 쓰지 않는 칸(null)과 다른 목적의 칸은 아예 빼서
// 목적 행이 없는 캠페인과 마찬가지로 응답에 새 값이 생기지 않는다. campaignIdExpression은 바깥 질의의 캠페인 id 식이다.
export function purposeSummarySql(campaignIdExpression: string): string {
  return `(SELECT jsonb_strip_nulls(jsonb_build_object(
            'kind', cp.purpose,
            'featuredMenuName', cp.featured_menu_name,
            'revisitMinDays', CASE WHEN cp.purpose = 'REVISIT' THEN cp.revisit_min_days END,
            'revisitWindowDays', CASE WHEN cp.purpose = 'REVISIT' THEN cp.revisit_window_days END,
            'nextStepText', cp.next_step_text,
            'timeWindows', cp.time_windows))
          FROM campaign_purposes cp WHERE cp.campaign_id = ${campaignIdExpression})`;
}

// DB가 CHECK로 보장하는 모양이지만 응답을 만들다 목록 전체가 깨지지 않도록 어긋나면 목적 없이 돌려준다.
export function parsePurposeSummary(value: unknown): CampaignPurposeSummary | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = campaignPurposes.find(candidate => candidate === record.kind);
  if (!kind) return undefined;
  const summary: CampaignPurposeSummary = { kind };
  if (typeof record.featuredMenuName === 'string') summary.featuredMenuName = record.featuredMenuName;
  if (kind === 'REVISIT') {
    if (Number.isInteger(record.revisitMinDays)) summary.revisitMinDays = record.revisitMinDays as number;
    if (Number.isInteger(record.revisitWindowDays)) summary.revisitWindowDays = record.revisitWindowDays as number;
    if (typeof record.nextStepText === 'string') summary.nextStepText = record.nextStepText;
  }
  if (kind === 'OFF_PEAK') {
    const windows = normalizeTimeWindows(record.timeWindows);
    if (!windows) return undefined;
    summary.timeWindows = windows;
  }
  return summary;
}

export async function insertCampaignPurpose(
  client: PoolClient, campaignId: string, settings: CampaignPurposeSettings,
): Promise<void> {
  await client.query(
    `INSERT INTO campaign_purposes(campaign_id, purpose, featured_menu_name, revisit_min_days, revisit_window_days,
       next_step_text, time_windows)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [campaignId, settings.purpose, settings.featuredMenuName, settings.revisitMinDays, settings.revisitWindowDays,
      settings.nextStepText, settings.timeWindows === null ? null : JSON.stringify(settings.timeWindows)],
  );
}

// 방문 기록 시각에 적용할 시간대. 목적 행이 없거나 시간대 조건이 없는 목적이면 null이다(옛 캠페인은 항상 null).
export function timeWindowsFromRow(value: unknown): TimeWindow[] | null {
  return normalizeTimeWindows(value) ?? null;
}
