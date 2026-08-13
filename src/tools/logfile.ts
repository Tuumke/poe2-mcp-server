import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  resolveLogFilePath,
  readLogTail,
  parseClientLog,
  getFallbackLogPath,
  hasSubstantialLogData,
  type ParsedLogData,
} from '../services/api.js';

const LogFilePathSchema = z
  .string()
  .optional()
  .describe('Override path to Client.txt. Omit to auto-detect from default install locations.');

const TailLinesSchema = z
  .number()
  .int()
  .min(100)
  .max(100_000)
  .default(10_000)
  .describe('Number of lines to read from the end of the file (default: 10000)');

/**
 * Format duration between two dates as "Xh Ym".
 * @param start — Start timestamp.
 * @param end — End timestamp.
 * @returns Formatted duration string.
 */
function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

/**
 * Format a timestamp as HH:MM:SS.
 * @param date — Date object.
 * @returns Time string.
 */
function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

/**
 * Format a timestamp as YYYY/MM/DD HH:MM:SS.
 * @param date — Date object.
 * @returns Full timestamp string.
 */
function formatFullTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const time = formatTime(date);
  return `${year}/${month}/${day} ${time}`;
}

/**
 * Format ParsedLogData as markdown session summary.
 * Returns raw player events for LLM interpretation (language-agnostic).
 * @param data — Parsed log data.
 * @param tailLines — Number of lines that were parsed.
 * @param logFilePath — Path to the log file that was used.
 * @returns Markdown-formatted summary.
 */
function formatLogSummary(data: ParsedLogData, tailLines: number, logFilePath: string): string {
  const lines: string[] = ['## PoE2 Log Analysis', ''];

  // Show which log file was used
  const fileName = logFilePath.includes('LatestClient.txt')
    ? 'LatestClient.txt (current session)'
    : 'Client.txt (full history)';
  lines.push(`**Source:** ${fileName}`);

  // Current zone with English name for translation
  if (data.lastZone) {
    const localName = data.lastZone.zoneName ?? data.lastZone.areaId;
    const englishName = data.lastZone.decoded?.englishName;
    const nameDisplay = englishName ? `${localName} / ${englishName}` : localName;
    lines.push(
      `**Current zone:** ${nameDisplay} (${data.lastZone.areaId}, level ${data.lastZone.areaLevel})`,
    );
  } else {
    lines.push('**Current zone:** Unknown');
  }

  // Log scope
  const firstTimestamp =
    data.sessions.length > 0
      ? data.sessions[0]!.startTime
      : data.zoneVisits.length > 0
        ? data.zoneVisits[0]!.timestamp
        : null;
  const lastTimestamp =
    data.sessions.length > 0 && data.sessions[data.sessions.length - 1]!.endTime
      ? data.sessions[data.sessions.length - 1]!.endTime!
      : data.zoneVisits.length > 0
        ? data.zoneVisits[data.zoneVisits.length - 1]!.timestamp
        : null;

  if (firstTimestamp && lastTimestamp) {
    lines.push(
      `**Log scope:** Last ${tailLines.toLocaleString('en-US')} lines (${formatFullTimestamp(firstTimestamp)} - ${formatTime(lastTimestamp)})`,
    );
  } else {
    lines.push(`**Log scope:** Last ${tailLines.toLocaleString('en-US')} lines`);
  }

  lines.push(
    `**Stats:** ${data.summary.totalSessions} session(s), ${data.summary.totalZoneVisits} zone(s), ${data.summary.totalPlayerEvents} event(s)`,
  );
  lines.push('');

  // Player events (raw messages for LLM to interpret)
  const playerEvents = data.playerEvents.filter((e) => e.category === 'player');
  lines.push(`### Player Events (${playerEvents.length})`);
  lines.push('');
  if (playerEvents.length > 0) {
    lines.push(
      '_Raw game messages — interpret these to find deaths, level-ups, trades, item events, etc._',
    );
    lines.push('');
    lines.push('| Time     | Message |');
    lines.push('| -------- | ------- |');
    // Show last 50 events to avoid overwhelming output
    const recentEvents = playerEvents.slice(-50);
    recentEvents.forEach((event) => {
      const time = formatTime(event.timestamp);
      // Escape pipe characters in markdown table
      const msg = event.rawMessage.replace(/\|/g, '\\|').slice(0, 100);
      lines.push(`| ${time} | ${msg} |`);
    });
    if (playerEvents.length > 50) {
      lines.push(`| ...      | (${playerEvents.length - 50} earlier events omitted) |`);
    }
  } else {
    lines.push('No player events in this log scope.');
  }
  lines.push('');

  // Zone history (last 10)
  lines.push('### Zone History (last 10)');
  lines.push('');
  if (data.zoneVisits.length > 0) {
    lines.push('| Time     | Area ID | Level | Local Name | English Name |');
    lines.push('| -------- | ------- | ----- | ---------- | ------------ |');
    const recentZones = data.zoneVisits.slice(-10);
    recentZones.forEach((zone) => {
      const time = formatTime(zone.timestamp);
      const localName = zone.zoneName ?? '-';
      const englishName = zone.decoded?.englishName ?? '-';
      lines.push(
        `| ${time} | ${zone.areaId} | ${zone.areaLevel} | ${localName} | ${englishName} |`,
      );
    });
  } else {
    lines.push('No zone visits in this log scope.');
  }
  lines.push('');

  // Sessions
  lines.push('### Sessions');
  lines.push('');
  if (data.sessions.length > 0) {
    lines.push('| Start               | End      | Duration |');
    lines.push('| ------------------- | -------- | -------- |');
    data.sessions.forEach((session) => {
      const start = formatFullTimestamp(session.startTime);
      const end = session.endTime ? formatTime(session.endTime) : '(active)';
      const duration = session.endTime ? formatDuration(session.startTime, session.endTime) : '?';
      lines.push(`| ${start} | ${end} | ${duration} |`);
    });
  } else {
    lines.push('No sessions detected in this log scope.');
  }

  return lines.join('\n');
}

/** Configuration options for logfile tools. */
export interface LogfileToolsConfig {
  /** PoE2 installation directory (from --poe2-path CLI arg). */
  poe2InstallPath?: string;
}

export function registerLogfileTools(server: McpServer, config: LogfileToolsConfig = {}): void {
  server.registerTool(
    'poe2_log_summary',
    {
      title: 'PoE2 Log Summary',
      description: `Parse the local PoE2 log file and return game events for analysis.

Extracts raw player events, zone transitions, and session timing from the game's
local log file. Uses structural parsing (language-agnostic) so it works with
any game language. Player events are returned raw — interpret them to identify
deaths, level-ups, trades, item events, etc.

The tool automatically detects the log file location (prioritizes LatestClient.txt
for current session, falls back to Client.txt for full history).

Args:
  - log_file_path (string, optional): Override path to log file. Omit to auto-detect.
  - tail_lines (number, optional): Number of lines to read from end (default: 10000, max: 100000)

Returns: Log analysis with zones, sessions, and raw player events for interpretation.

Examples:
  - "How many times did I die?" -> Look for death messages in player events
  - "What zone am I in?" -> Check current zone
  - "What level am I?" -> Look for level-up messages in player events`,
      inputSchema: {
        log_file_path: LogFilePathSchema,
        tail_lines: TailLinesSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ log_file_path, tail_lines }) => {
      try {
        const resolvedPath = resolveLogFilePath(log_file_path, config.poe2InstallPath);
        const lines = readLogTail(resolvedPath, tail_lines);
        let data = parseClientLog(lines);
        let usedPath = resolvedPath;

        // Fallback to Client.txt if LatestClient.txt has insufficient data
        // (e.g., user just restarted game, session too fresh)
        if (!hasSubstantialLogData(data)) {
          const fallbackPath = getFallbackLogPath(resolvedPath);
          if (fallbackPath) {
            const fallbackLines = readLogTail(fallbackPath, tail_lines);
            const fallbackData = parseClientLog(fallbackLines);
            // Use fallback only if it has more data
            if (
              fallbackData.summary.totalZoneVisits > data.summary.totalZoneVisits ||
              fallbackData.summary.totalPlayerEvents > data.summary.totalPlayerEvents
            ) {
              data = fallbackData;
              usedPath = fallbackPath;
            }
          }
        }

        const markdown = formatLogSummary(data, tail_lines, usedPath);

        return {
          content: [{ type: 'text', text: markdown }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    },
  );
}
