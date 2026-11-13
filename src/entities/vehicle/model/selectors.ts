import type { FleetFrame, Issue, VehicleSnapshot } from '@shared/api'

export function activeIssues(vehicle: VehicleSnapshot): Issue[] {
  return vehicle.issues.filter((issue) => issue.status !== 'resolved')
}

export function fleetSummary(frame: FleetFrame) {
  const issues = frame.vehicles.flatMap(activeIssues)
  return {
    vehicles: frame.vehicles.length,
    open: issues.filter((issue) => issue.status === 'open').length,
    resolving: issues.filter((issue) => issue.status === 'resolving').length,
    critical: issues.filter((issue) => issue.severity === 'critical').length,
  }
}

