import { expect, test } from '@playwright/test';
import { encodePulseTrain } from '../src/lib/encoder';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('页面标题与输入区', async ({ page }) => {
  await expect(page).toHaveTitle('磁标脉冲串解码器');
  await expect(page.getByTestId('pulse-input')).toBeVisible();
  await expect(page.getByTestId('decode-btn')).toBeVisible();
});

test('decoded：合法串展示数字串、最小 τ 与 SVG 分类图', async ({ page }) => {
  const train = encodePulseTrain('0042', 100);
  await page.getByTestId('pulse-input').fill(JSON.stringify(train));
  await page.getByTestId('decode-btn').click();

  await expect(page.getByTestId('outcome')).toContainText('decoded');
  await expect(page.getByTestId('digits')).toHaveText('0042');
  await expect(page.getByTestId('min-tau')).toHaveText('94');
  await expect(page.getByTestId('result')).toContainText('有效 τ 共 13 个');

  const svg = page.getByTestId('diagram').locator('svg');
  await expect(svg).toBeVisible();
  expect(await svg.locator('rect').count()).toBeGreaterThan(10);
});

test('unreadable：无任何 τ 有效', async ({ page }) => {
  await page.getByTestId('pulse-input').fill('[20, 21, 22, 20, 21, 20]');
  await page.getByTestId('decode-btn').click();
  await expect(page.getByTestId('outcome')).toContainText('unreadable');
  await expect(page.getByTestId('unreadable-panel')).toBeVisible();
});

test('输入错误按位置稳定汇总，且整份拒绝并清除旧结果', async ({ page }) => {
  // 先得到一次成功结果
  await page.getByTestId('pulse-input').fill(JSON.stringify(encodePulseTrain('7', 100)));
  await page.getByTestId('decode-btn').click();
  await expect(page.getByTestId('outcome')).toContainText('decoded');

  // 再提交多处非法输入
  await page.getByTestId('pulse-input').fill('[100, "x", 999, 50, true, 100]');
  await page.getByTestId('decode-btn').click();

  const errors = page.getByTestId('errors');
  await expect(errors).toBeVisible();
  const paths = await errors.locator('code').allTextContents();
  expect(paths.slice(0, 3)).toEqual(['$[1]', '$[2]', '$[4]']);

  // 旧结果已清除
  await expect(page.getByTestId('result')).toHaveCount(0);

  // 重复解码同一非法串，错误顺序稳定
  await page.getByTestId('decode-btn').click();
  const paths2 = await page.getByTestId('errors').locator('code').allTextContents();
  expect(paths2).toEqual(paths);
});

test('长度与顶层类型错误也被拒绝', async ({ page }) => {
  await page.getByTestId('pulse-input').fill('[1, 2]');
  await page.getByTestId('decode-btn').click();
  await expect(page.getByTestId('errors')).toContainText('$');
  await expect(page.getByTestId('errors')).toContainText('6..200');

  await page.getByTestId('pulse-input').fill('{"a":1}');
  await page.getByTestId('decode-btn').click();
  await expect(page.getByTestId('errors')).toContainText('JSON 数组');
});

test('漂移 + 抖动串仍稳定给出唯一 decoded', async ({ page }) => {
  // 规格的 ambiguous 分支在真实脉冲上受区间互斥性约束（见 README 数学说明），
  // 其 UI 由 Vitest 组件测试用构造数据覆盖；本用例验证漂移串多 τ 同串。
  const train = encodePulseTrain('789', 100, { drift: 3, jitter: 1, seed: 7 });
  await page.getByTestId('pulse-input').fill(JSON.stringify(train));
  await page.getByTestId('decode-btn').click();
  await expect(page.getByTestId('outcome')).toContainText('decoded');
  await expect(page.getByTestId('digits')).toHaveText('789');
  await expect(page.getByTestId('result')).toContainText('有效 τ 共 5 个');
  await expect(page.getByTestId('min-tau')).toHaveText('98');
});
