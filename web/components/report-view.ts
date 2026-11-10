// The report: tokens, cost, score and rework. Numbers carry the meaning; the bars beside them are decoration.
import type { ReportData } from '../../src/engine/report.ts';
import { Component } from '../lib/component.ts';
import { html, raw } from '../lib/dom.ts';
import { minutes, money, plural, tokens } from '../lib/format.ts';
import { facts, FORMULA, infoTip, tableRegion } from './shared.ts';

const FACTOR: Record<string, string> = {
  correctness: 'Correctness',
  quality: 'Quality',
  satisfaction: 'Satisfaction',
  tokens: 'Token use',
  speed: 'Speed',
  completion: 'Completion',
};

class ReportView extends Component<ReportData> {
  protected render(d: ReportData): void {
    const score = d.score ? `${d.score.score}` : 'Not scored yet';
    const compare = d.previous !== undefined ? html` <span class="muted">last ${d.previous}, best ${d.best}</span>` : raw('');
    const tested = d.score ? (d.score.tested ? `Yes, ${d.score.intensity ?? ''} intensity` : 'No') : 'Not yet';

    const agents = d.agents.map((a) => html`<tr>
      <th scope="row">${a.agent}</th><td>${a.models}</td><td class="num">${a.sessions}</td><td class="num">${a.turns}</td>
      <td class="num">${tokens(a.effective)}</td>
      <td class="share"><span class="bar" aria-hidden="true"><span data-share="${a.share}"></span></span><span class="num">${a.share}%</span></td>
      <td class="num">${money(a.cost)}</td></tr>`);
    const tasks = d.tasks.map((t) => html`<tr>
      <th scope="row" class="mono">${t.task}</th><td>${t.title}</td><td class="num">${t.sessions}</td><td class="num">${t.fixes}</td>
      <td class="num">${tokens(t.effective)}</td><td class="num">${money(t.cost)}</td></tr>`);
    const factors = d.score
      ? Object.entries(d.score.factors).map(([k, v]) => html`<tr><th scope="row">${FACTOR[k] ?? k}</th><td class="num">${v === null ? 'Not tested' : v}</td><td class="num">${d.score!.points[k as keyof typeof d.score.points] ?? '–'}</td></tr>`)
      : [];

    this.paint(html`
      <section aria-labelledby="report-title">
        <h2 id="report-title" data-focus>Report</h2>
        ${facts([
          ['Score', html`<span class="fact-value">${score}${compare}</span>${infoTip('Score formula', FORMULA.score)}`],
          ['Tokens', html`<span class="fact-value">${tokens(d.effective)} effective</span>${infoTip('Token formula', FORMULA.tokens)}`],
          ['Cost', html`<span class="fact-value">${money(d.cost)}</span>${infoTip('Cost formula', FORMULA.cost)}${d.cost_note ? html`<warning-tip label="Cost warning">${d.cost_note}</warning-tip>` : raw('')}`],
          ['Time', `${minutes(d.minutes)} working, ${minutes(d.wait_minutes)} waiting for you`],
          ['Tested', tested],
        ])}
      </section>

      ${d.agents.length ? html`<section aria-labelledby="t-agents"><h3 id="t-agents">Tokens by agent</h3>
        ${tableRegion('t-agents-cap', 'Tokens and cost for each agent', ['Agent', 'Model', 'Sessions', 'Turns', 'Effective', 'Share', 'Cost'], agents, [2, 3, 4, 6], false)}</section>` : raw('')}

      ${d.tasks.length ? html`<section aria-labelledby="t-tasks"><h3 id="t-tasks">Developer tasks</h3>
        ${tableRegion('t-tasks-cap', 'Tokens and cost for each task', ['Task', 'Title', 'Sessions', 'Fix rounds', 'Effective', 'Cost'], tasks, [2, 3, 4, 5], false)}</section>` : raw('')}

      <section aria-labelledby="t-activity"><h3 id="t-activity">Rework, questions and bugs</h3>
        ${facts([
          ['Rework', d.rework.length ? html`<ul class="plain">${d.rework.map((r) => html`<li>${r.gate}: ${plural(r.count, 'rerun', 'reruns')} <span class="muted">${r.tasks}</span></li>`)}</ul>` : 'None'],
          ['Questions', d.questions.length ? html`<ul class="plain">${d.questions.map((q) => html`<li>${q.from}: ${q.count}</li>`)}</ul>` : 'None'],
          ['Bugs', d.bugs.length ? html`<ul class="plain">${d.bugs.map((b) => html`<li>${b.risk} risk: ${b.total} found, ${b.fixed} fixed</li>`)}</ul>` : 'None'],
          ['Bug types', d.bug_types.map((t) => `${t.type} ${t.count}`).join(', ')],
        ])}
      </section>

      ${d.score ? html`<section aria-labelledby="t-score"><h3 id="t-score">Score breakdown</h3>
        ${tableRegion('t-score-cap', 'Points for each factor', ['Factor', 'Value', 'Points'], factors, [1, 2], false)}
        ${d.score.capped ? html`<p class="note">Capped at 60 because a requirement did not pass.</p>` : raw('')}</section>` : raw('')}`);

    this.querySelectorAll<HTMLElement>('[data-share]').forEach((el) => {
      el.style.width = `${Math.min(100, Number(el.dataset.share) || 0)}%`;
    });
  }
}

customElements.define('report-view', ReportView);
