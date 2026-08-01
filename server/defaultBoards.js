'use strict';

// Builds a fresh set of placeholder clues for a board.
// `multiplier` scales the dollar values (board 2 is "Double Jeopardy").
function buildCategory(name, multiplier) {
  const baseValues = [200, 400, 600, 800, 1000];
  return {
    name,
    clues: baseValues.map((base) => ({
      value: base * multiplier,
      question: `Edit this clue text for "${name}" ($${base * multiplier}).`,
      answer: 'Edit this answer text.',
      dailyDouble: false,
      used: false,
    })),
  };
}

function buildDefaultBoard(name, categoryNames, multiplier) {
  return {
    name,
    categories: categoryNames.map((catName) => buildCategory(catName, multiplier)),
  };
}

function createDefaultBoards() {
  const board1Categories = [
    'THE I.T. GUY',
    'PUBLISHED FIRST',
    'STATE OF EMERGENCY',
    'TV',
    'A BILL IN CONGRESS',
    '"UN" ENDING',
  ];
  const board2Categories = [
    'CATEGORY 1',
    'CATEGORY 2',
    'CATEGORY 3',
    'CATEGORY 4',
    'CATEGORY 5',
    'CATEGORY 6',
  ];

  return [
    buildDefaultBoard('Jeopardy Round', board1Categories, 1),
    buildDefaultBoard('Double Jeopardy Round', board2Categories, 2),
  ];
}

module.exports = { createDefaultBoards, buildCategory, buildDefaultBoard };
