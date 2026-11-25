// One boss per map. Pick "Boss" as the CPU difficulty for a 1v1 Speed Race against that map's boss.
// Every boss learns from each race (oni.js brain) and beating one unlocks their car (Garage › Boss, a tab you only see once you own one).
// Midnight Oni (Kurogane Pass) also turns up on pole in Hard and Legend races on any map.
export const BOSSES = {
  track: {
    id: 'valkyrie', name: 'Valkyrie', title: 'Ingrid "Valkyrie" Holm', icon: '🛡️', color: '#7fb4ff', car: 'valkyrie',
    cfg: { paint: '#c9ced6', wheel: '#1d3c78', rim: 1, kit: 2, lowered: 1, underglow: '#4a8cff', livery: 1, liveryColor: '#1d3c78' },
    lines: {
      start: ['Clean lines. Late brakes. Try to keep up.', 'This circuit has no secrets from me.', 'I have never missed an apex.'],
      remember: ['I have studied every metre of your last race.', 'Same track. Better me.'],
      passed: ['A lucky gap. Enjoy it.', 'You braked later than I thought. Interesting.'],
      passes: ['Precision beats bravery.', 'Watch my line. Learn something.'],
      win: ['Perfect lap. As always.', 'Come back when your lines are cleaner.'],
      lose: ['...Impressive. The Valkyrie RS is yours.', 'You out-drove me. Take the car.'],
    },
  },
  desert: {
    id: 'sandstorm', name: 'Sandstorm', title: 'Rex "Sandstorm" Calder', icon: '🌪️', color: '#e0a54a', car: 'mirage',
    cfg: { paint: '#c8a46a', wheel: '#151515', rim: 2, kit: 1, lowered: 0, underglow: '', livery: 1, liveryColor: '#151515' },
    lines: {
      start: ['Out here, top speed is all that matters.', 'Eat my dust, kid.', 'Twelve kilometres of highway. All mine.'],
      remember: ['I know where you lift. I don\'t.', 'The desert remembers you.'],
      passed: ['Huh. Didn\'t see you in the dust.', 'Okay, okay. You can drive.'],
      passes: ['V8 says goodbye.', 'See you at the finish. Maybe.'],
      win: ['The desert always wins.', 'Better luck next storm.'],
      lose: ['Well, I\'ll be. The Mirage is yours.', 'You beat the storm. Keys are in it.'],
    },
  },
  mountain: {
    id: 'oni', name: 'Midnight Oni', title: 'Midnight Oni', icon: '👹', color: '#ff4a3a', car: 'oni',
    cfg: { paint: '#0c0c0e', wheel: '#b01010', rim: 3, kit: 2, lowered: 1, underglow: '#ff1a12', livery: 2, liveryColor: '#c8140f' },
    lines: {
      start: ['Midnight belongs to me.', 'Try to keep up. Nobody ever does.', 'You hear that engine? That is your nightmare.', 'Another challenger. How cute.'],
      remember: ['I remember this track. And I remember you.', 'I studied your lines. Let\'s see what you have left.', 'Every race you teach me something. Thank you.'],
      passed: ['Hmph. Enjoy it while it lasts.', 'Lucky. It won\'t happen twice.', 'Oh? So you can drive.'],
      passes: ['Too slow.', 'See you at the finish. Eventually.', 'Was that your best?', 'Bye bye.'],
      win: ['As expected. Come back when you are ready.', 'The night is still mine.'],
      lose: ['...Impossible. Take the car. You earned it.', 'Well driven. The Oni bows to you.'],
    },
  },
  forest: {
    id: 'grizzly', name: 'Grizzly', title: 'Bjorn "Grizzly" Vale', icon: '🐻', color: '#8fcf6a', car: 'timber',
    cfg: { paint: '#2f5d3a', wheel: '#e8e8e8', rim: 4, kit: 1, lowered: 0, underglow: '', livery: 1, liveryColor: '#f2f2f2' },
    lines: {
      start: ['These trails are my backyard.', 'Mind the trees. I won\'t.', 'Gravel, mud, rain. I love all of it.'],
      remember: ['I tracked your every move last time.', 'A bear never forgets a trail.'],
      passed: ['Grr. Fine. You found the shortcut.', 'Not bad for a city kid.'],
      passes: ['Out of my woods!', 'Too careful on the gravel.'],
      win: ['The forest is mine.', 'Go home, cub.'],
      lose: ['Ha! Respect. Take the Timber Rally.', 'You out-drove a bear. The car is yours.'],
    },
  },
  city: {
    id: 'phantom', name: 'Phantom', title: 'The Phantom', icon: '👻', color: '#b58cff', car: 'phantom',
    cfg: { paint: '#2a1740', wheel: '#1ee3ff', rim: 5, kit: 2, lowered: 1, underglow: '#1ee3ff', livery: 2, liveryColor: '#1ee3ff' },
    lines: {
      start: ['You won\'t even see me.', 'These streets are mine after dark.', 'Blink and I\'m gone.'],
      remember: ['I was watching you last time. I always am.', 'Every corner of this city knows my name.'],
      passed: ['...How did you get there?', 'A ghost can wait.'],
      passes: ['Boo.', 'Gone.', 'You\'re chasing a shadow.'],
      win: ['Nobody catches the Phantom.', 'Lights out.'],
      lose: ['You caught a ghost. The Phantom GT is yours.', 'Nobody has ever seen my face. Take the car.'],
    },
  },
  drift: {
    id: 'ironjaw', name: 'Ironjaw', title: 'Marcus "Ironjaw" Kane', icon: '⚓', color: '#ffd23a', car: 'ironjaw',
    cfg: { paint: '#151515', wheel: '#ffd23a', rim: 0, kit: 2, lowered: 1, underglow: '#ffb000', livery: 1, liveryColor: '#ffd23a' },
    lines: {
      start: ['Welcome to my harbour.', 'I don\'t brake. I slide.', 'Ironbay has one king.'],
      remember: ['I saw your lines last time. Weak.', 'The docks remember everything.'],
      passed: ['Hah! Bold. I like it.', 'Okay, the kid has teeth.'],
      passes: ['Iron beats tin.', 'Out of my way, rookie.'],
      win: ['Ironbay stays mine.', 'Too soft for the docks.'],
      lose: ['You broke the Ironjaw. The 440 is yours.', 'Respect, rookie. Take my car.'],
    },
  },
};
export const bossFor = (map) => BOSSES[map] || BOSSES.mountain;
export const BOSS_UNLOCKS = Object.values(BOSSES).map((b) => b.id); // secret.js unlock names
