function parseYmd(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  return new Date(`${s}T00:00:00`);
}

function dayCount(startStr, endStr) {
  const start = parseYmd(startStr);
  const end = parseYmd(endStr);
  if (!start || !end || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function overlapFraction(exportStart, exportEnd, filterStart, filterEnd) {
  if (!exportStart || !exportEnd || !filterStart || !filterEnd) return 1;

  const es = parseYmd(exportStart).getTime();
  const ee = parseYmd(exportEnd).getTime();
  const fs = parseYmd(filterStart).getTime();
  const fe = parseYmd(filterEnd).getTime();

  const overlapStart = Math.max(es, fs);
  const overlapEnd = Math.min(ee, fe);
  if (overlapEnd < overlapStart) return 0;

  const overlapDays = Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
  const exportDays = Math.floor((ee - es) / 86400000) + 1;
  return exportDays > 0 ? overlapDays / exportDays : 0;
}

function parseFunnelDateRange(dateRange) {
  if (!dateRange) return null;
  const match = String(dateRange).match(/(\d{8})-(\d{8})/);
  if (!match) return null;
  return {
    start: `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`,
    end: `${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}`,
  };
}

function prorateTrafficRows(rows, filterStart, filterEnd) {
  const byChannel = {};

  for (const row of rows) {
    const fraction = overlapFraction(row.start_date, row.end_date, filterStart, filterEnd);
    if (fraction <= 0) continue;

    const channel = row.channel_group;
    if (!byChannel[channel]) {
      byChannel[channel] = {
        ...row,
        sessions: 0,
        engaged_sessions: 0,
        event_count: 0,
        key_events: 0,
        _weight: 0,
        _engagementTimeSum: 0,
      };
    }

    const sessions = Math.round(row.sessions * fraction);
    const engaged = Math.round(row.engaged_sessions * fraction);
    const bucket = byChannel[channel];
    bucket.sessions += sessions;
    bucket.engaged_sessions += engaged;
    bucket.event_count += Math.round(row.event_count * fraction);
    bucket.key_events += Math.round(row.key_events * fraction);
    bucket._engagementTimeSum += row.avg_engagement_time * sessions;
    bucket._weight += sessions;
  }

  return Object.values(byChannel)
    .map((row) => ({
      ...row,
      engagement_rate: row.sessions > 0 ? row.engaged_sessions / row.sessions : 0,
      avg_engagement_time: row._weight > 0 ? row._engagementTimeSum / row._weight : 0,
      events_per_session: row.sessions > 0 ? row.event_count / row.sessions : 0,
      session_key_event_rate: row.sessions > 0 ? row.key_events / row.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

function proratePagesRows(rows, filterStart, filterEnd) {
  const byPath = {};

  for (const row of rows) {
    const fraction = overlapFraction(row.start_date, row.end_date, filterStart, filterEnd);
    if (fraction <= 0) continue;

    const path = row.page_path;
    if (!byPath[path]) {
      byPath[path] = {
        ...row,
        views: 0,
        active_users: 0,
        event_count: 0,
        key_events: 0,
        _engagementTimeSum: 0,
        _usersForTime: 0,
      };
    }

    const bucket = byPath[path];
    // GA4 Pages exports are period totals for the CSV date range, not daily rates.
    const views = row.views || 0;
    const users = row.active_users || 0;
    bucket.views += views;
    bucket.active_users += users;
    bucket.event_count += row.event_count || 0;
    bucket.key_events += row.key_events || 0;
    bucket._engagementTimeSum += row.avg_engagement_time * users;
    bucket._usersForTime += users;
  }

  return Object.values(byPath)
    .map((row) => ({
      ...row,
      views_per_user: row.active_users > 0 ? row.views / row.active_users : 0,
      avg_engagement_time: row._usersForTime > 0 ? row._engagementTimeSum / row._usersForTime : 0,
    }))
    .sort((a, b) => b.views - a.views);
}

function prorateFunnelRows(rows, filterStart, filterEnd) {
  const byKey = {};

  for (const row of rows) {
    const range = parseFunnelDateRange(row.date_range);
    const fraction = range
      ? overlapFraction(range.start, range.end, filterStart, filterEnd)
      : 1;
    if (fraction <= 0) continue;

    const key = `${row.company}|${row.step}|${row.device_category}`;
    if (!byKey[key]) {
      byKey[key] = { ...row, active_users: 0, abandonments: 0 };
    }

    byKey[key].active_users += Math.round(row.active_users * fraction);
    byKey[key].abandonments += Math.round(row.abandonments * fraction);
  }

  return Object.values(byKey).sort((a, b) => {
    const stepCmp = (a.step || '').localeCompare(b.step || '');
    if (stepCmp !== 0) return stepCmp;
    return (a.device_category || '').localeCompare(b.device_category || '');
  });
}

function trafficKpisFromRows(rows) {
  const totalSessions = rows.reduce((s, r) => s + (r.sessions || 0), 0);
  const totalEngaged = rows.reduce((s, r) => s + (r.engaged_sessions || 0), 0);
  return {
    totalSessions,
    totalEngagedSessions: totalEngaged,
    engagementRate: totalSessions > 0
      ? Math.round((totalEngaged / totalSessions) * 1000) / 10
      : 0,
  };
}

function prorateUsersRows(rows, filterStart, filterEnd) {
  const byChannel = {};

  for (const row of rows) {
    const fraction = overlapFraction(row.start_date, row.end_date, filterStart, filterEnd);
    if (fraction <= 0) continue;

    const channel = row.channel_group;
    if (!byChannel[channel]) {
      byChannel[channel] = {
        ...row,
        total_users: 0,
        new_users: 0,
        returning_users: 0,
        event_count: 0,
        key_events: 0,
        _engagementTimeSum: 0,
        _usersForTime: 0,
      };
    }

    const bucket = byChannel[channel];
    // GA4 User Acquisition exports are period totals for the CSV date range, not daily
    // rates — never scale down by overlap fraction (that wrongly turns 550 MTD into ~423).
    const users = row.total_users || 0;
    bucket.total_users += users;
    bucket.new_users += row.new_users || 0;
    bucket.returning_users += row.returning_users || 0;
    bucket.event_count += row.event_count || 0;
    bucket.key_events += row.key_events || 0;
    bucket._engagementTimeSum += row.avg_engagement_time * users;
    bucket._usersForTime += users;
  }

  return Object.values(byChannel)
    .map((row) => ({
      ...row,
      avg_engagement_time: row._usersForTime > 0 ? row._engagementTimeSum / row._usersForTime : 0,
      engaged_sessions_per_user: row.total_users > 0
        ? (row.engaged_sessions_per_user || 0)
        : 0,
    }))
    .sort((a, b) => b.total_users - a.total_users);
}

const GA4_ORGANIC_SEARCH_CHANNELS = new Set(['Organic Search', 'AI Overview', 'AI Assistant']);
const GA4_ORGANIC_SOCIAL_CHANNEL = 'Organic Social';

function websiteUsersSourceBreakdown(rows) {
  const totalUsers = rows.reduce((s, r) => s + (r.total_users || 0), 0);
  let organicSearchUsers = 0;
  let organicSocialUsers = 0;
  for (const row of rows) {
    const ch = row.channel_group || '';
    const users = row.total_users || 0;
    if (GA4_ORGANIC_SEARCH_CHANNELS.has(ch)) {
      organicSearchUsers += users;
    } else if (ch === GA4_ORGANIC_SOCIAL_CHANNEL) {
      organicSocialUsers += users;
    }
  }
  const otherUsers = Math.max(0, totalUsers - organicSearchUsers - organicSocialUsers);
  const pctOfTotal = (n) => (totalUsers > 0 ? Math.round((n / totalUsers) * 1000) / 10 : null);
  return {
    totalUsers,
    organicSearchUsers,
    organicSocialUsers,
    otherUsers,
    organicSearchPct: pctOfTotal(organicSearchUsers),
    organicSocialPct: pctOfTotal(organicSocialUsers),
    otherPct: pctOfTotal(otherUsers),
  };
}

function websiteUsersSourceBreakdownFromChannelMap(channelMap) {
  const rows = Object.entries(channelMap || {}).map(([channel_group, total_users]) => ({
    channel_group,
    total_users,
  }));
  return websiteUsersSourceBreakdown(rows);
}

function usersKpisFromRows(rows) {
  const totalUsers = rows.reduce((s, r) => s + (r.total_users || 0), 0);
  const newUsers = rows.reduce((s, r) => s + (r.new_users || 0), 0);
  const returningUsers = rows.reduce((s, r) => s + (r.returning_users || 0), 0);
  return {
    totalUsers,
    newUsers,
    returningUsers,
    newUserRate: totalUsers > 0
      ? Math.round((newUsers / totalUsers) * 1000) / 10
      : 0,
  };
}

module.exports = {
  overlapFraction,
  parseFunnelDateRange,
  prorateTrafficRows,
  prorateUsersRows,
  proratePagesRows,
  prorateFunnelRows,
  trafficKpisFromRows,
  usersKpisFromRows,
  websiteUsersSourceBreakdown,
  websiteUsersSourceBreakdownFromChannelMap,
  dayCount,
};
