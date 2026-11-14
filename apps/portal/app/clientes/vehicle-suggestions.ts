const modelsByMake = {
  Acura: ["ILX", "Integra", "MDX", "RDX", "TLX"],
  Audi: ["A3", "A4", "A6", "Q3", "Q5", "Q7"],
  BMW: ["Serie 3", "Serie 5", "X1", "X3", "X5", "X6"],
  Chevrolet: ["Colorado", "Equinox", "Silverado", "Spark", "Tahoe", "Tracker", "Traverse"],
  Ford: ["Bronco", "EcoSport", "Escape", "Explorer", "F-150", "Ranger"],
  Honda: ["Accord", "City", "Civic", "CR-V", "Fit", "HR-V", "Odyssey", "Pilot"],
  Hyundai: ["Accent", "Elantra", "Grand i10", "Santa Fe", "Sonata", "Tucson", "Venue"],
  Isuzu: ["D-Max", "MU-X", "NPR"],
  Jeep: ["Cherokee", "Compass", "Grand Cherokee", "Renegade", "Wrangler"],
  Kia: ["K5", "Picanto", "Rio", "Seltos", "Sorento", "Soul", "Sportage"],
  Lexus: ["ES", "GX", "IS", "LX", "NX", "RX"],
  Mazda: ["BT-50", "CX-3", "CX-30", "CX-5", "CX-9", "Mazda 2", "Mazda 3"],
  "Mercedes-Benz": ["Clase A", "Clase C", "Clase E", "GLA", "GLC", "GLE"],
  Mitsubishi: ["ASX", "L200", "Montero", "Montero Sport", "Outlander", "Xpander"],
  Nissan: ["Frontier", "Kicks", "NP300", "Pathfinder", "Qashqai", "Sentra", "Versa", "X-Trail"],
  Subaru: ["Crosstrek", "Forester", "Impreza", "Outback", "WRX"],
  Suzuki: ["Baleno", "Celerio", "Grand Vitara", "Jimny", "Swift", "Vitara"],
  Toyota: ["Camry", "Corolla", "Corolla Cross", "Fortuner", "Hilux", "Land Cruiser", "Prado", "RAV4", "Rush", "Tacoma", "Yaris"],
  Volkswagen: ["Amarok", "Golf", "Jetta", "Polo", "Taos", "Tiguan"],
} as const;

const types = ["Automóvil privado", "Camioneta", "Camión", "Furgoneta", "Miniván", "Motocicleta", "SUV", "Sedán"];
const colors = ["Amarillo", "Azul", "Beige", "Blanco", "Dorado", "Gris", "Marrón", "Naranja", "Negro", "Plateado", "Rojo", "Verde", "Vino"];

export function suggestedVehicleModels(make: string) {
  const key = Object.keys(modelsByMake).find(brand => brand.toLowerCase() === make.trim().toLowerCase()) as keyof typeof modelsByMake | undefined;
  return key ? modelsByMake[key] : [];
}

export function vehicleSuggestions(make: string) {
  const newestYear = new Date().getFullYear() + 1;
  return {
    vehicle_type: types,
    make: Object.keys(modelsByMake),
    model: suggestedVehicleModels(make),
    year: Array.from({ length: newestYear - 1979 }, (_, index) => String(newestYear - index)),
    color: colors,
  };
}
