// FSRS Algorithm v4.5 - Free Spaced Repetition Scheduler
(function(global) {
  'use strict';

  const DEFAULT_PARAMETERS = {
    w: [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61],
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: false
  };

  const Rating = {
    Again: 1,
    Hard: 2,
    Good: 3,
    Easy: 4
  };

  const State = {
    New: 0,
    Learning: 1,
    Review: 2,
    Relearning: 3
  };

  class FSRS {
    constructor(params = {}) {
      this.params = { ...DEFAULT_PARAMETERS, ...params };
      this.w = this.params.w;
    }

    createEmptyCard(now = new Date()) {
      return {
        due: now.toISOString(),
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: State.New,
        lastReview: null
      };
    }

    initDifficulty(rating) {
      return this.w[4] - Math.exp(this.w[5] * (rating - 1)) + 1;
    }

    initStability(rating) {
      return Math.max(0.1, this.w[rating - 1]);
    }

    nextDifficulty(difficulty, rating) {
      const nextD = difficulty - this.w[6] * (rating - 3);
      return Math.min(Math.max(nextD, 1), 10);
    }

    nextRecallStability(difficulty, stability, retrievability, rating) {
      const hardPenalty = rating === Rating.Hard ? this.w[15] : 1;
      const easyBonus = rating === Rating.Easy ? this.w[16] : 1;
      return stability * (1 + Math.exp(this.w[8]) * 
        (11 - difficulty) * Math.pow(stability, -this.w[9]) * 
        (Math.exp((1 - retrievability) * this.w[10]) - 1) * 
        hardPenalty * easyBonus);
    }

    nextForgetStability(difficulty, stability, retrievability) {
      return this.w[11] * Math.pow(difficulty, -this.w[12]) * 
        (Math.pow(stability + 1, this.w[13]) - 1) * 
        Math.exp((1 - retrievability) * this.w[14]);
    }

    nextInterval(stability) {
      const interval = stability / (9 * (1 - this.params.requestRetention)) * 
        Math.log(this.params.requestRetention);
      return Math.min(Math.max(1, Math.round(interval)), this.params.maximumInterval);
    }

    schedule(card, now = new Date()) {
      const scheduled = {};
      
      for (let rating = 1; rating <= 4; rating++) {
        scheduled[rating] = this.nextState(card, rating, now);
      }
      
      return scheduled;
    }

    nextState(card, rating, now) {
      let newCard = { ...card };
      const lastReview = new Date(card.lastReview || now);
      const elapsedDays = Math.max(0, (now - lastReview) / (1000 * 60 * 60 * 24));
      
      newCard.elapsedDays = elapsedDays;
      newCard.lastReview = now.toISOString();
      newCard.reps = card.reps + 1;

      if (card.state === State.New) {
        newCard.difficulty = this.initDifficulty(rating);
        newCard.stability = this.initStability(rating);
        newCard.scheduledDays = 0;
        newCard.due = this.nextDueDate(rating, now);
        newCard.state = rating === Rating.Again ? State.Learning : State.Review;
      } 
      else if (card.state === State.Learning || card.state === State.Relearning) {
        if (rating === Rating.Again) {
          newCard.scheduledDays = 0;
          newCard.due = this.nextDueDate(Rating.Again, now);
          newCard.state = card.state;
          newCard.lapses = card.lapses + (card.state === State.Relearning ? 0 : 1);
        } else {
          newCard.difficulty = this.nextDifficulty(card.difficulty, rating);
          const retrievability = this.getRetrievability(card, now);
          newCard.stability = this.nextRecallStability(newCard.difficulty, card.stability, retrievability, rating);
          newCard.scheduledDays = this.nextInterval(newCard.stability);
          newCard.due = this.addDays(now, newCard.scheduledDays);
          newCard.state = State.Review;
        }
      } 
      else if (card.state === State.Review) {
        newCard.difficulty = this.nextDifficulty(card.difficulty, rating);
        
        if (rating === Rating.Again) {
          newCard.stability = this.nextForgetStability(newCard.difficulty, card.stability, this.getRetrievability(card, now));
          newCard.scheduledDays = 0;
          newCard.due = this.nextDueDate(Rating.Again, now);
          newCard.state = State.Relearning;
          newCard.lapses = card.lapses + 1;
        } else {
          const retrievability = this.getRetrievability(card, now);
          newCard.stability = this.nextRecallStability(newCard.difficulty, card.stability, retrievability, rating);
          newCard.scheduledDays = this.nextInterval(newCard.stability);
          newCard.due = this.addDays(now, newCard.scheduledDays);
          newCard.state = State.Review;
        }
      }

      return { card: newCard, interval: newCard.scheduledDays };
    }

    nextDueDate(rating, now) {
      const intervals = { 1: 1, 2: 3, 3: 10, 4: 4 };
      const minutes = intervals[rating] || 10;
      const due = new Date(now.getTime() + minutes * 60000);
      return due.toISOString();
    }

    addDays(date, days) {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result.toISOString();
    }

    getRetrievability(card, now = new Date()) {
      if (card.state === State.New) return 0;
      const elapsed = (now - new Date(card.lastReview || now)) / (1000 * 60 * 60 * 24);
      return Math.exp(Math.log(0.9) * elapsed / card.stability);
    }
  }

  global.FSRS = FSRS;
  global.Rating = Rating;
  global.State = State;

})(typeof window !== 'undefined' ? window : global);