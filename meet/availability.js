export function availabilityStatus(slot, answers) {
  const value = answers.get(slot.id);
  return value === true ? 'available' : value === false ? 'unavailable' : 'unanswered';
}

export const statusLabels = {
  available: 'Available', unavailable: 'Not available',
  unanswered: 'Not answered yet'
};
