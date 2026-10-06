/**
 * Where everyone is staying. Addresses, directions and the rental office are
 * fine to keep here; the front-door codes and the guest-guide confirmation
 * number are NOT, because this repository is public on GitHub. Those live in
 * the database as settings (Admin → Lodging) and are shown to signed-in
 * players only. The keys below are the setting names.
 */

export const LODGING = {
  manager: 'Ledges Vacation Rentals',
  officePhone: '435-634-4660',
  textLine: '435-294-3451',
  mailingAddress: '5224 N Winchester Hills Drive, St. George, UT 84770',
  checkIn: 'After 4:00 PM, Saturday Oct 10',
  checkOut: 'Before 11:00 AM, Tuesday Oct 13',
  codeHolder: 'Aaron Klein',
  guestGuideArrival: '10/10/2026',
  /** Setting key holding the guest-guide confirmation number. */
  confirmationKey: 'lodging.confirmation',
  houses: [
    {
      id: 'peace',
      name: 'Red Rock Peace',
      address: '4975 N Escapes Drive, St. George, UT 84770',
      whichSide: 'house number 4975, on your left',
      codeKey: 'lodging.peace.code',
    },
    {
      id: 'getaway',
      name: 'Red Rock Getaway',
      address: '4958 N Escapes Drive, St. George, UT 84770',
      whichSide: 'house number 4958, on your right',
      codeKey: 'lodging.getaway.code',
    },
  ],
  /** Same route for both houses — they're across the street from each other. */
  directions: [
    'Head north on N Bluff St / UT-18 N toward W Sunset Blvd',
    'Stay in the right lane and continue north on UT-18 N (5.2 miles)',
    'Take the Ledges Parkway exit (0.3 miles)',
    'At the roundabout, take the first exit',
    'Take the first left onto Canyon Tree Drive',
    'At the first roundabout, take the third exit',
    'Turn left onto Escapes Drive',
  ],
  keypad: [
    'Type the front door code on the keypad by the door.',
    'A green light means it took. You now have 5 seconds to twist the silver knob to unlock the deadbolt.',
    'Push or turn the handle and you’re in.',
  ],
} as const;

export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`;
}

export function smsLink(phone: string): string {
  return `sms:${phone.replace(/\D/g, '')}`;
}
