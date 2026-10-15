export class AnalyticsController {
  /**
   * @param {import('../storage/dataStore.js').DataStore} dataStore
   * @param {import('../core/analyticsService.js').AnalyticsService} analyticsService
   */
  constructor(dataStore, analyticsService) {
    this.store = dataStore;
    this.service = analyticsService;
  }

  getDashboard = async (req, res, next) => {
    try {
      const kpis = this.service.getDashboardKpis();
      const turnover = this.service.calculateInventoryTurnover();
      res.json({ data: { kpis, turnover } });
    } catch (err) {
      next(err);
    }
  };

  getTimeline = async (req, res, next) => {
    try {
      const interval = req.query.interval === 'monthly' ? 'monthly' : 'daily';
      const limit = Number(req.query.limit) || 30;
      const timeline = this.service.getRevenueTimeline(interval, limit);
      res.json({ data: timeline });
    } catch (err) {
      next(err);
    }
  };

  exportInventoryCsv = async (req, res, next) => {
    try {
      const csv = this.service.exportInventoryCsv();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="inventory-stock-export.csv"');
      res.send(csv);
    } catch (err) {
      next(err);
    }
  };
}
