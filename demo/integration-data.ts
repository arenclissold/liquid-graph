export const integrationSeries = [
  { label: 'House deposit', color: '#75d5f1', values: [3200, 5200, 5200, 8900, 9200, 7400, 13800, 13800, 11400, 17200, 16800, 24680] },
  { label: 'Japan trip', color: '#b9a2f7', values: [800, 800, 2600, 3100, 5600, 5800, 5800, 6400, 1800, 200, 0, 950] },
  { label: 'Rainy day', color: '#9cdeb2', values: [9100, 9100, 4300, 5100, 5700, 2400, 3000, 3000, 6900, 7500, 8100, 8100] },
] as const;
export const integrationMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const integrationMoney = (value: number) => `$${value.toLocaleString('en-AU')}`;
export type IntegrationDataset = typeof integrationSeries[number];
export const integrationRows = (series: IntegrationDataset) => series.values.map((balance, month) => ({ month, label: integrationMonths[month]!, balance }));
