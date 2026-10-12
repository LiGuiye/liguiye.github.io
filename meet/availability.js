export function availabilityStatus(slot, answers) {
  const value = answers.get(slot.id);
  return value === true ? 'available' : value === false ? 'unavailable' : 'unanswered';
}

export function savedResponses(participants, availability) {
  return participants.map(person => ({
    person,
    answers: new Map(availability.filter(answer => answer.participantId === person.id).map(answer => [answer.slotId, answer.available]))
  })).filter(({ answers }) => answers.size > 0);
}

export const statusLabels = {
  available: 'Available', unavailable: 'Not available',
  unanswered: 'Not answered yet'
};
