export function createDemoHistoryModule() {
  let initialized = false;
  let mountainId = null;
  let riverId = null;
  let cityId = null;
  let collisionEventId = null;
  let mountainEventId = null;
  let riverEventId = null;

  return {
    id: 'demo.history-chain',
    initialize(world) {
      if (initialized) return;
      initialized = true;
      mountainId = world.createEntity('mountain', { elevation: 1200 }, 'mountain-1').id;
      riverId = world.createEntity('river', { discharge: 0 }, 'river-1').id;
      cityId = world.createEntity('city', { population: 0, status: 'unfounded' }, 'city-1').id;

      collisionEventId = world.history.record({
        type: 'plate-collision',
        time: 0,
        title: 'Continental plates begin colliding',
        entities: [mountainId],
        location: { x: 42, y: 19 },
      }).id;
      mountainEventId = world.history.record({
        type: 'mountain-uplift',
        time: 0,
        title: 'A mountain range begins rising',
        entities: [mountainId],
        causes: [collisionEventId],
      }).id;
    },
    step(years, world) {
      const time = world.getTimeYears();
      const mountain = world.getEntity(mountainId);
      world.updateEntity(mountainId, {
        components: { elevation: mountain.components.elevation + years * 0.18 },
      });

      if (!riverEventId && time + years >= 800) {
        world.updateEntity(riverId, { components: { discharge: 42 } });
        riverEventId = world.history.record({
          type: 'river-formed',
          time: 800,
          title: 'Rainfall carves a permanent river',
          entities: [riverId, mountainId],
          causes: [mountainEventId],
        }).id;
      }

      if (riverEventId && world.getEntity(cityId).components.status === 'unfounded' && time + years >= 1500) {
        world.updateEntity(cityId, { components: { population: 83, status: 'founded' } });
        world.history.record({
          type: 'city-founded',
          time: 1500,
          title: 'A settlement is founded beside the river',
          description: 'Reliable water and fertile sediment support permanent settlement.',
          entities: [cityId, riverId],
          causes: [riverEventId],
        });
      }
    },
    save() {
      return { initialized, mountainId, riverId, cityId, collisionEventId, mountainEventId, riverEventId };
    },
    load(state) {
      if (!state) return;
      ({ initialized, mountainId, riverId, cityId, collisionEventId, mountainEventId, riverEventId } = state);
    },
  };
}
