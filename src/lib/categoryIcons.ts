import {
  Car, ShoppingCart, Utensils, Coffee, Home, Zap, HeartPulse, Shield, Smartphone, Monitor, Briefcase, GraduationCap, Plane, Music, PlaySquare, Dumbbell, Gift, Baby, Dog, Receipt, Wallet, Banknote, CreditCard, Landmark, CircleDollarSign, Tag, Search, Circle,
  Ticket, TrainFront, BusFront, Droplet, Flame, Gamepad2, Camera, Book, Wine, Beer, Tv, Wifi, Wrench, Hammer, Sofa, Shirt, Watch, Umbrella, Smile, Brush, Palette, Globe, MapPin, Building, Trees, Flower2, HeartHandshake, PiggyBank, Scale, Coins, Bitcoin, Cpu, Battery, Fuel, Trophy, Scissors, Gem, Glasses, Headphones, Speaker, Mic, Film, Video
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, React.FC<any>> = {
  Car, ShoppingCart, Utensils, Coffee, Home, Zap, HeartPulse, Shield, Smartphone, Monitor, Briefcase, GraduationCap, Plane, Music, PlaySquare, Dumbbell, Gift, Baby, Dog, Receipt, Wallet, Banknote, CreditCard, Landmark, CircleDollarSign, Tag, Search, Circle,
  Ticket, TrainFront, BusFront, Droplet, Flame, Gamepad2, Camera, Book, Wine, Beer, Tv, Wifi, Wrench, Hammer, Sofa, Shirt, Watch, Umbrella, Smile, Brush, Palette, Globe, MapPin, Building, Trees, Flower2, HeartHandshake, PiggyBank, Scale, Coins, Bitcoin, Cpu, Battery, Fuel, Trophy, Scissors, Gem, Glasses, Headphones, Speaker, Mic, Film, Video
};

export const AVAILABLE_ICONS = Object.keys(CATEGORY_ICONS);

export function getBestGuessIcon(categoryName: string): string {
  const name = categoryName.toLowerCase();
  
  if (name.includes("grocer") || name.includes("supermarket")) return "ShoppingCart";
  if (name.includes("restaur") || name.includes("din") || name.includes("food") || name.includes("eat")) return "Utensils";
  if (name.includes("coffee") || name.includes("cafe")) return "Coffee";
  if (name.includes("alcohol") || name.includes("wine") || name.includes("liquor")) return "Wine";
  if (name.includes("bar") || name.includes("pub") || name.includes("beer")) return "Beer";
  if (name.includes("car") || name.includes("auto") || name.includes("repair")) return "Car";
  if (name.includes("gas") || name.includes("fuel")) return "Fuel";
  if (name.includes("train") || name.includes("subway") || name.includes("transit") || name.includes("metro")) return "TrainFront";
  if (name.includes("bus")) return "BusFront";
  if (name.includes("flight") || name.includes("travel") || name.includes("vacation") || name.includes("trip")) return "Plane";
  if (name.includes("home") || name.includes("mortgage") || name.includes("rent") || name.includes("house")) return "Home";
  if (name.includes("utilit") || name.includes("electric")) return "Zap";
  if (name.includes("water bill")) return "Droplet";
  if (name.includes("health") || name.includes("medical") || name.includes("doctor") || name.includes("pharmacy")) return "HeartPulse";
  if (name.includes("insur")) return "Shield";
  if (name.includes("phone") || name.includes("mobile") || name.includes("cell")) return "Smartphone";
  if (name.includes("internet") || name.includes("wifi") || name.includes("broadband")) return "Wifi";
  if (name.includes("tech") || name.includes("software") || name.includes("computer")) return "Monitor";
  if (name.includes("work") || name.includes("business") || name.includes("office")) return "Briefcase";
  if (name.includes("edu") || name.includes("school") || name.includes("college") || name.includes("tuition") || name.includes("book")) return "Book";
  if (name.includes("music") || name.includes("spotify") || name.includes("concert")) return "Music";
  if (name.includes("entert") || name.includes("movie") || name.includes("netflix") || name.includes("hulu") || name.includes("cinema") || name.includes("film") || name.includes("theater") || name.includes("tv") || name.includes("television")) return "Tv";
  if (name.includes("game") || name.includes("gaming") || name.includes("playstation") || name.includes("xbox") || name.includes("nintendo")) return "Gamepad2";
  if (name.includes("gym") || name.includes("fitness") || name.includes("workout")) return "Dumbbell";
  if (name.includes("gift") || name.includes("present")) return "Gift";
  if (name.includes("charity") || name.includes("donation") || name.includes("giving")) return "HeartHandshake";
  if (name.includes("baby") || name.includes("kids") || name.includes("child")) return "Baby";
  if (name.includes("pet") || name.includes("dog") || name.includes("cat") || name.includes("vet")) return "Dog";
  if (name.includes("tax") || name.includes("fee") || name.includes("service")) return "Receipt";
  if (name.includes("income") || name.includes("paycheck") || name.includes("salary")) return "Banknote";
  if (name.includes("credit card") || name.includes("payment")) return "CreditCard";
  if (name.includes("bank") || name.includes("transfer") || name.includes("atm")) return "Landmark";
  if (name.includes("shopping") || name.includes("apparel") || name.includes("clothes") || name.includes("clothing") || name.includes("shoes") || name.includes("wardrobe")) return "Shirt";
  if (name.includes("invest") || name.includes("savings")) return "PiggyBank";
  if (name.includes("crypto") || name.includes("bitcoin")) return "Bitcoin";
  if (name.includes("hair") || name.includes("salon") || name.includes("barber")) return "Scissors";
  if (name.includes("hardware") || name.includes("diy") || name.includes("tools")) return "Hammer";
  if (name.includes("furniture") || name.includes("decor")) return "Sofa";
  
  return "Circle"; // Fallback dot-like icon
}
