// Small helpers shared by the CLI and the web UI when a run is started.

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

// A skill source is owner/repo, optionally with @skill, or an https URL.
// Only these characters reach the shell that installs the skill, so nothing else is allowed.
const SOURCE = /^(https:\/\/[\w.\-/:~%+]+|[\w.-]+\/[\w.-]+(@[\w.:-]+)?)$/;

export function validSource(s: string): boolean {
  return SOURCE.test(s);
}
