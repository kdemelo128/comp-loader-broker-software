/* Home: the pipeline, tasks, contacts, activity and deliverables, and a
 * deal's Pipeline card, kept consistent with each other and across a reload. */
import { phone, BASE, SHOTS } from './lib.mjs';
import { execFileSync } from 'child_process';
const F = new URL('./files/', import.meta.url).pathname;
const { browser, page, errors } = await phone();
const R = []; const check = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const go = async (v) => { await page.evaluate((x) => { location.hash = x; }, `#${v}`); await page.waitForTimeout(400); };
const tileV = async (k) => (await page.$$eval('#home-root .home-tiles .tile', (t) => t.map((x) => [x.querySelector('.k').textContent, x.querySelector('.v').textContent, x.querySelector('.s')?.textContent || '']))).find((x) => x[0] === k);
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });

await page.goto(BASE + '#home', { waitUntil: 'load' });
await page.waitForSelector('#home-root h1');
check('Home tab opens with empty states', /No deals yet/.test(await page.textContent('#home-pipeline')) && /Nothing to do yet/.test(await page.textContent('#home-tasks')));

// a deal, its stage, a next step and a contact, from the Deal screen
await go('deal');
await page.setInputFiles('#om-file', F + 'om-retail.pdf');
await page.waitForSelector('#deal-crm #deal-stage');
check('a new deal starts in Underwriting', (await page.inputValue('#deal-stage')) === 'underwriting');
await page.selectOption('#deal-stage', 'offer');
await page.fill('#deal-task-title', 'Send LOI to listing broker');
await page.fill('#deal-task-due', today);
await page.press('#deal-task-title', 'Enter');
await page.waitForFunction(() => /Send LOI/.test(document.querySelector('#deal-crm').textContent));
check('the next step shows on the deal', /Send LOI to listing broker/.test(await page.textContent('#deal-crm')) && /due today/.test(await page.textContent('#deal-crm')));
await page.locator('#deal-crm button', { hasText: '+ New contact' }).click();
await page.waitForSelector('#contact-name');
await page.fill('#contact-name', 'Dana Whitlock');
await page.fill('#contact-company', 'Harbor Capital Advisors');
await page.selectOption('#contact-role', 'Seller’s broker');
await page.fill('#contact-phone', '(202) 555-0147');
await page.fill('#contact-email', 'dana@example.com');
await page.click('#contact-save');
await page.waitForFunction(() => /Dana Whitlock/.test(document.querySelector('#deal-crm').textContent));
check('the contact is linked to the deal, with call and email links', await page.locator('#deal-crm a[href="tel:2025550147"]').count() === 1 && await page.locator('#deal-crm a[href="mailto:dana@example.com"]').count() === 1);
// a deliverable from the Deal tab
await page.evaluate(() => { window.print = () => {}; });
await page.click('#deal-root button[aria-label="More deal actions"] >> visible=true');
await page.locator('dialog.action-sheet .action-item', { hasText: 'Deal brief' }).click();
await page.waitForTimeout(500);

// Home reflects it all
await go('home');
await page.waitForSelector('#home-pipeline .pipe');
const dealName = await page.locator('#home-pipeline .pipe-col[data-stage="offer"] .pipe-open b').first().textContent();
check('the deal sits in Offer / LOI with its price and cap', /4410 Example Avenue/.test(dealName) && /\$6\.45M · 6\.10% cap/.test(await page.textContent('#home-pipeline .pipe-col[data-stage="offer"]')), dealName);
let t = await tileV('Active deals');
check('active deals and value', t[1] === '1' && /\$6\.45M asking/.test(t[2]), t.join(' | '));
t = await tileV('Due today');
check('a task due today is counted', t[1] === '1', t.join(' | '));
check('the task shows under Today with its deal', /Today \(1\)/.test(await page.textContent('#home-tasks')) && /Send LOI/.test(await page.textContent('#home-tasks')) && /4410 Example/.test(await page.textContent('#home-tasks')));
check('the contact is listed with role, company and deal', /Dana Whitlock.*Seller’s broker · Harbor Capital Advisors · 4410 Example/s.test(await page.textContent('#home-contacts')));
await page.fill('#contact-search', 'lender');
check('contact search narrows', /No contact matches/.test(await page.textContent('#home-contacts')));
await page.fill('#contact-search', 'harbor');
check('contact search by company', /Dana Whitlock/.test(await page.textContent('#home-contacts')));
await page.fill('#contact-search', '');
const act = await page.textContent('#home-activity');
check('activity lists the stage change, task, contact and the printed brief for the deal', /Underwriting → Offer \/ LOI/.test(act) && /Task added: Send LOI/.test(act) && /Contact added: Dana Whitlock/.test(act) && /Printed: Deal brief: 4410 Example Avenue NWjust/.test(act), act.slice(0, 400));

// move the deal from Home; the Deal screen must agree
await page.selectOption('#home-pipeline .pipe-col[data-stage="offer"] select', 'contract');
await page.waitForTimeout(500);
check('the deal moves to Under contract', await page.locator('#home-pipeline .pipe-col[data-stage="contract"] .pipe-card').count() === 1);
await page.locator('#home-pipeline .pipe-col[data-stage="contract"] .pipe-open').click();
await page.waitForSelector('#deal-stage');
check('the open deal shows the stage set on Home', (await page.inputValue('#deal-stage')) === 'contract');
await go('home');

// tasks: an overdue one with no deal, then tick today's done
await page.fill('#task-title', 'Renew CoStar subscription');
await page.fill('#task-due', '2020-01-15');
await page.click('#home-tasks button[type=submit]');
await page.waitForFunction(() => /Overdue \(1\)/.test(document.querySelector('#home-tasks').textContent));
check('an overdue task is flagged, and named in Needs attention', /1 task is overdue/.test(await page.textContent('#home-attention')) && /was due/.test(await page.textContent('#home-tasks')));
await page.check('#home-tasks input[aria-label="Done: Send LOI to listing broker"]');
await page.waitForTimeout(400);
t = await tileV('Due today');
check('ticking it done clears it from today', t[1] === '0', t.join(' | '));
check('the deal now needs a next step', /no next step set/.test(await page.textContent('#home-attention')));
await page.locator('#home-tasks button', { hasText: 'Show done' }).click();
await page.waitForTimeout(300);
check('done tasks can be shown, struck through', await page.locator('#home-tasks .task-row.done').count() === 1);
check('no horizontal page overflow on Home', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.screenshot({ path: `${SHOTS}home.png`, fullPage: true });

// the pipeline report
await page.click('#pipeline-report');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('dialog.action-sheet .action-item', { hasText: 'Excel workbook' }).click()]);
const xl = `${SHOTS}pipeline.xlsx`;
await dl.saveAs(xl);
const wb = JSON.parse(execFileSync('python3', ['-c', 'import openpyxl,json,sys; wb=openpyxl.load_workbook(sys.argv[1]); print(json.dumps({ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in wb}, default=str))', xl]).toString());
const pr = wb.Pipeline[1];
check('report: three sheets', Object.keys(wb).join(',') === 'Pipeline,Tasks,Contacts');
check('report: the deal row with stage, price, NOI and cap as numbers', pr[1] === 'Under contract' && pr[4] === 6450000 && pr[5] === 393450 && Math.abs(pr[6] - 393450 / 6450000) < 1e-12, JSON.stringify(pr));
check('report: tasks and contacts', wb.Tasks.length === 3 && wb.Contacts[1][0] === 'Dana Whitlock' && /4410 Example/.test(wb.Contacts[1][5]));
await page.waitForTimeout(300);
check('the report itself is logged as produced', /Saved: Pipeline .*\.xlsx/.test(await page.textContent('#home-activity')));

// everything survives a reload
await page.reload({ waitUntil: 'load' });
await go('home');
await page.waitForSelector('#home-pipeline .pipe');
check('after reload: stage, tasks and contact kept', await page.locator('#home-pipeline .pipe-col[data-stage="contract"] .pipe-card').count() === 1 && /Overdue \(1\)/.test(await page.textContent('#home-tasks')) && /Dana Whitlock/.test(await page.textContent('#home-contacts')));

// delete a contact, then undo
await page.locator('#home-contacts .contact-main').first().click();
await page.locator('#sheet-foot button', { hasText: 'Delete' }).click();
await page.waitForTimeout(300);
check('contact deleted', !/Dana Whitlock/.test(await page.textContent('#home-contacts')));
await page.locator('.toast button', { hasText: 'Undo' }).click();
await page.waitForTimeout(400);
check('undo brings the contact back', /Dana Whitlock/.test(await page.textContent('#home-contacts')));

// narrowest phone
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(300);
check('no overflow at 320 px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), String(await page.evaluate(() => document.documentElement.scrollWidth)));
const txt = await page.locator('#app').innerText();
check('no NaN/undefined/Infinity', !/\b(NaN|undefined|Infinity)\b/.test(txt));
for (const [s, n, d] of R) console.log(s, '|', n, d ? `| ${d}` : '');
console.log('PASS', R.filter((x) => x[0] === 'PASS').length, 'FAIL', R.filter((x) => x[0] === 'FAIL').length, 'errors', errors);
await browser.close();
