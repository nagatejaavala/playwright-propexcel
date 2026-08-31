import {
  FlowPerfTracker,
  FlowPerformanceReport,
  FlowStepTiming,
  formatDurationSec,
  saveFlowPerformance,
} from './FlowPerformance';

export type OrgCreateStepTiming = FlowStepTiming;

export type OrgCreatePerformanceReport = FlowPerformanceReport & {
  email: string;
};

/** @deprecated use FlowPerfTracker */
export class OrgCreatePerfTracker extends FlowPerfTracker {
  buildReport(orgId: string, orgName: string, email: string): OrgCreatePerformanceReport {
    const base = super.buildReport({
      flow: 'CreateOrganization',
      orgId,
      orgName,
      tenantEmail: email,
    });
    return { ...base, email };
  }

  logSummary(report: OrgCreatePerformanceReport): void {
    super.logSummary(report);
  }
}

export function saveOrgCreatePerformance(report: OrgCreatePerformanceReport): string {
  return saveFlowPerformance('org-create-performance', report);
}

export { formatDurationSec };
