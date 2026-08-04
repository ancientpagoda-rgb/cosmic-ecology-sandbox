#include <emscripten/emscripten.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "rebound.h"

#define RS_MAX_PARTICLES 192
#define RS_STATE_STRIDE 8
#define RS_PI 3.14159265358979323846
#define RS_G_AU_SOLAR_DAY 0.0002959122082855911025
#define RS_AU_METERS 149597870700.0
#define RS_SOLAR_KG 1.98847e30

static struct reb_simulation* rs_sim = NULL;
static uint32_t rs_rng = 1u;
static uint32_t rs_seed = 1u;
static int rs_planets_requested = 6;
static int rs_asteroids_requested = 48;
static int rs_living_index = -1;
static int rs_impact_count = 0;
static double rs_initial_energy = 0.0;
static double rs_last_impact_energy_value = 0.0;
static double rs_last_impact_speed_value = 0.0;
static int rs_last_impact_target_value = -1;
static double rs_state[RS_MAX_PARTICLES * RS_STATE_STRIDE];

static uint32_t rs_rand_u32(void){
    uint32_t x = rs_rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rs_rng = x ? x : 1u;
    return rs_rng;
}

static double rs_rand01(void){
    return (double)(rs_rand_u32() & 0x00ffffffu) / 16777216.0;
}

static double rs_rand_range(double minimum, double maximum){
    return minimum + (maximum - minimum) * rs_rand01();
}

static int rs_name_starts(const char* name, const char* prefix){
    if (!name || !prefix) return 0;
    return strncmp(name, prefix, strlen(prefix)) == 0;
}

static int rs_type_from_name(const char* name){
    if (!name) return 5;
    if (strcmp(name, "Star") == 0) return 0;
    if (strcmp(name, "Living World") == 0) return 2;
    if (strcmp(name, "Moon") == 0) return 3;
    if (rs_name_starts(name, "Asteroid")) return 4;
    if (rs_name_starts(name, "Planet")) return 1;
    return 5;
}

static void rs_name_particle(size_t index, const char* name){
    if (!rs_sim || index >= rs_sim->N) return;
    reb_particle_set_name(&rs_sim->particles[index], name);
}

static size_t rs_add_cartesian(const char* name, double mass, double radius,
                               double x, double y, double z,
                               double vx, double vy, double vz){
    struct reb_particle particle = {0};
    particle.m = mass;
    particle.r = radius;
    particle.x = x;
    particle.y = y;
    particle.z = z;
    particle.vx = vx;
    particle.vy = vy;
    particle.vz = vz;
    reb_simulation_add(rs_sim, particle);
    const size_t index = rs_sim->N - 1;
    rs_name_particle(index, name);
    return index;
}

static size_t rs_add_orbit(const char* name, size_t primary_index,
                           double mass, double radius, double a, double e,
                           double inclination, double ascending_node,
                           double argument_periapsis, double true_anomaly){
    const struct reb_particle primary = rs_sim->particles[primary_index];
    struct reb_particle particle = reb_particle_from_orbit(
        rs_sim->G,
        primary,
        mass,
        a,
        e,
        inclination,
        ascending_node,
        argument_periapsis,
        true_anomaly
    );
    particle.r = radius;
    reb_simulation_add(rs_sim, particle);
    const size_t index = rs_sim->N - 1;
    rs_name_particle(index, name);
    return index;
}

static enum REB_COLLISION_RESOLVE_OUTCOME rs_collision_resolve(
    struct reb_simulation* const simulation,
    struct reb_collision collision
){
    if (collision.p1 >= simulation->N || collision.p2 >= simulation->N){
        return REB_COLLISION_RESOLVE_OUTCOME_REMOVE_NONE;
    }

    struct reb_particle* p1 = &simulation->particles[collision.p1];
    struct reb_particle* p2 = &simulation->particles[collision.p2];
    const int type1 = rs_type_from_name(p1->name);
    const int type2 = rs_type_from_name(p2->name);
    const int asteroid1 = type1 == 4;
    const int asteroid2 = type2 == 4;

    if (asteroid1 || asteroid2){
        struct reb_particle* projectile = asteroid1 ? p1 : p2;
        struct reb_particle* target = asteroid1 ? p2 : p1;
        const double dvx = projectile->vx - target->vx;
        const double dvy = projectile->vy - target->vy;
        const double dvz = projectile->vz - target->vz;
        const double speed_au_day = sqrt(dvx*dvx + dvy*dvy + dvz*dvz);
        const double speed_m_s = speed_au_day * RS_AU_METERS / 86400.0;
        const double mass_kg = projectile->m * RS_SOLAR_KG;
        rs_last_impact_speed_value = speed_m_s;
        rs_last_impact_energy_value = 0.5 * mass_kg * speed_m_s * speed_m_s;
        rs_last_impact_target_value = rs_type_from_name(target->name);
        rs_impact_count += 1;
        return asteroid1
            ? REB_COLLISION_RESOLVE_OUTCOME_REMOVE_P1
            : REB_COLLISION_RESOLVE_OUTCOME_REMOVE_P2;
    }

    rs_last_impact_target_value = type1 == 0 ? type2 : type1;
    rs_impact_count += 1;
    return reb_collision_resolve_merge(simulation, collision);
}

static void rs_add_generated_planets(int count){
    static const double base_a[] = {0.39, 0.72, 1.00, 1.52, 2.35, 5.20, 9.54, 15.8};
    static const double base_mass[] = {1.65e-7, 2.45e-6, 3.003e-6, 3.23e-7, 8.0e-7, 9.54e-4, 2.86e-4, 4.4e-5};
    static const double base_radius[] = {1.63e-5, 4.05e-5, 4.27e-5, 2.27e-5, 3.2e-5, 4.67e-4, 3.89e-4, 1.69e-4};

    if (count < 3) count = 3;
    if (count > 8) count = 8;

    for (int index = 0; index < count; index += 1){
        char name[32];
        const int living = index == 2;
        snprintf(name, sizeof(name), living ? "Living World" : "Planet %d", index + 1);
        const double jitter = living ? 0.0 : rs_rand_range(-0.025, 0.025);
        const double a = base_a[index] * (1.0 + jitter);
        const double e = living ? 0.0167 : rs_rand_range(0.002, 0.085);
        const double inclination = living ? 0.0 : rs_rand_range(0.0, 0.065);
        const double node = rs_rand_range(0.0, 2.0 * RS_PI);
        const double periapsis = rs_rand_range(0.0, 2.0 * RS_PI);
        const double anomaly = rs_rand_range(0.0, 2.0 * RS_PI);
        const size_t particle_index = rs_add_orbit(
            name,
            0,
            base_mass[index] * rs_rand_range(0.88, 1.14),
            base_radius[index],
            a,
            e,
            inclination,
            node,
            periapsis,
            anomaly
        );
        if (living) rs_living_index = (int)particle_index;
    }

    if (rs_living_index >= 0){
        rs_add_orbit(
            "Moon",
            (size_t)rs_living_index,
            3.694e-8,
            1.16e-5,
            0.00257,
            0.0549,
            0.0898,
            rs_rand_range(0.0, 2.0 * RS_PI),
            rs_rand_range(0.0, 2.0 * RS_PI),
            rs_rand_range(0.0, 2.0 * RS_PI)
        );
    }
}

static void rs_add_asteroids(int count){
    if (count < 0) count = 0;
    if (count > 128) count = 128;
    const size_t massive_count = rs_sim->N;
    rs_sim->N_active = massive_count;
    rs_sim->testparticle_type = 0;

    for (int index = 0; index < count; index += 1){
        char name[32];
        snprintf(name, sizeof(name), "Asteroid %03d", index + 1);
        double a;
        double e;
        if (index < 8){
            a = rs_rand_range(0.91, 1.11);
            e = rs_rand_range(0.08, 0.28);
        }else{
            a = rs_rand_range(1.65, 3.45);
            e = rs_rand_range(0.01, 0.31);
        }
        const double inclination = rs_rand_range(0.0, index < 8 ? 0.12 : 0.24);
        const double asteroid_mass = rs_rand_range(2.0e-16, 8.0e-15);
        rs_add_orbit(
            name,
            0,
            asteroid_mass,
            rs_rand_range(2.0e-6, 1.2e-5),
            a,
            e,
            inclination,
            rs_rand_range(0.0, 2.0 * RS_PI),
            rs_rand_range(0.0, 2.0 * RS_PI),
            rs_rand_range(0.0, 2.0 * RS_PI)
        );
    }
}

EMSCRIPTEN_KEEPALIVE
int rs_init(uint32_t seed, int planet_count, int asteroid_count){
    if (rs_sim){
        reb_simulation_free(rs_sim);
        rs_sim = NULL;
    }

    rs_seed = seed ? seed : 1u;
    rs_rng = rs_seed;
    rs_planets_requested = planet_count;
    rs_asteroids_requested = asteroid_count;
    rs_living_index = -1;
    rs_impact_count = 0;
    rs_last_impact_energy_value = 0.0;
    rs_last_impact_speed_value = 0.0;
    rs_last_impact_target_value = -1;

    rs_sim = reb_simulation_create();
    if (!rs_sim) return 0;
    rs_sim->G = RS_G_AU_SOLAR_DAY;
    rs_sim->dt = 0.35;
    rs_sim->exact_finish_time = 0;
    rs_sim->collision = REB_COLLISION_DIRECT;
    rs_sim->collision_resolve = rs_collision_resolve;
    rs_sim->track_energy_offset = 1;
    reb_simulation_set_integrator(rs_sim, "mercurius");

    rs_add_cartesian("Star", 1.0, 0.00465047, 0, 0, 0, 0, 0, 0);
    rs_add_generated_planets(planet_count);
    rs_add_asteroids(asteroid_count);
    reb_simulation_move_to_com(rs_sim);
    rs_initial_energy = reb_simulation_energy(rs_sim);
    return (int)rs_sim->N;
}

EMSCRIPTEN_KEEPALIVE
int rs_reset(void){
    return rs_init(rs_seed, rs_planets_requested, rs_asteroids_requested);
}

EMSCRIPTEN_KEEPALIVE
int rs_set_integrator(int mode){
    if (!rs_sim) return 0;
    if (mode == 1){
        reb_simulation_set_integrator(rs_sim, "ias15");
        rs_sim->dt = 0.12;
    }else if (mode == 2){
        reb_simulation_set_integrator(rs_sim, "whfast");
        rs_sim->dt = 0.22;
    }else{
        reb_simulation_set_integrator(rs_sim, "mercurius");
        rs_sim->dt = 0.35;
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int rs_step(double days){
    if (!rs_sim || !isfinite(days) || days <= 0.0) return 0;
    if (days > 36525.0) days = 36525.0;
    const double target = rs_sim->t + days;
    const enum REB_STATUS status = reb_simulation_integrate(rs_sim, target);
    reb_simulation_synchronize(rs_sim);
    return (int)status;
}

EMSCRIPTEN_KEEPALIVE
int rs_spawn_impactor(void){
    if (!rs_sim || rs_living_index < 0 || (size_t)rs_living_index >= rs_sim->N) return -1;
    struct reb_particle earth = rs_sim->particles[rs_living_index];
    const double radial_length = sqrt(earth.x*earth.x + earth.y*earth.y + earth.z*earth.z);
    if (radial_length <= 0.0) return -1;
    const double rx = earth.x / radial_length;
    const double ry = earth.y / radial_length;
    const double rz = earth.z / radial_length;
    char name[32];
    snprintf(name, sizeof(name), "Asteroid impactor %d", rs_impact_count + 1);
    const size_t index = rs_add_cartesian(
        name,
        4.0e-15,
        2.0e-5,
        earth.x + rx * 0.0020,
        earth.y + ry * 0.0020,
        earth.z + rz * 0.0020,
        earth.vx - rx * 0.0010,
        earth.vy - ry * 0.0010,
        earth.vz - rz * 0.0010
    );
    return (int)index;
}

EMSCRIPTEN_KEEPALIVE
int rs_write_state(void){
    if (!rs_sim) return 0;
    reb_simulation_synchronize(rs_sim);
    const size_t count = rs_sim->N < RS_MAX_PARTICLES ? rs_sim->N : RS_MAX_PARTICLES;
    for (size_t index = 0; index < count; index += 1){
        const struct reb_particle* particle = &rs_sim->particles[index];
        const size_t offset = index * RS_STATE_STRIDE;
        rs_state[offset + 0] = particle->x;
        rs_state[offset + 1] = particle->y;
        rs_state[offset + 2] = particle->z;
        rs_state[offset + 3] = particle->vx;
        rs_state[offset + 4] = particle->vy;
        rs_state[offset + 5] = particle->vz;
        rs_state[offset + 6] = particle->m;
        rs_state[offset + 7] = particle->r;
    }
    return (int)count;
}

EMSCRIPTEN_KEEPALIVE
double* rs_state_buffer(void){
    return rs_state;
}

EMSCRIPTEN_KEEPALIVE
int rs_count(void){
    return rs_sim ? (int)rs_sim->N : 0;
}

EMSCRIPTEN_KEEPALIVE
double rs_time(void){
    return rs_sim ? rs_sim->t : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double rs_energy_error(void){
    if (!rs_sim || rs_initial_energy == 0.0) return 0.0;
    const double energy = reb_simulation_energy(rs_sim) + rs_sim->energy_offset;
    return fabs((energy - rs_initial_energy) / rs_initial_energy);
}

EMSCRIPTEN_KEEPALIVE
int rs_impacts(void){
    return rs_impact_count;
}

EMSCRIPTEN_KEEPALIVE
double rs_last_impact_energy(void){
    return rs_last_impact_energy_value;
}

EMSCRIPTEN_KEEPALIVE
double rs_last_impact_speed(void){
    return rs_last_impact_speed_value;
}

EMSCRIPTEN_KEEPALIVE
int rs_last_impact_target(void){
    return rs_last_impact_target_value;
}

EMSCRIPTEN_KEEPALIVE
int rs_living_world_index(void){
    if (!rs_sim) return -1;
    struct reb_particle* living = reb_simulation_get_particle_by_name(rs_sim, "Living World");
    if (!living) return -1;
    rs_living_index = reb_simulation_particle_index(living);
    return rs_living_index;
}

EMSCRIPTEN_KEEPALIVE
int rs_particle_type(int index){
    if (!rs_sim || index < 0 || (size_t)index >= rs_sim->N) return -1;
    return rs_type_from_name(rs_sim->particles[index].name);
}

EMSCRIPTEN_KEEPALIVE
const char* rs_particle_name(int index){
    if (!rs_sim || index < 0 || (size_t)index >= rs_sim->N) return "";
    return rs_sim->particles[index].name ? rs_sim->particles[index].name : "";
}

EMSCRIPTEN_KEEPALIVE
uint32_t rs_system_seed(void){
    return rs_seed;
}
