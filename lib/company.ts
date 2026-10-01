// Company profile shown on the careers site. Edit freely: everything on the public pages about the company comes
// from here. Facts gathered in October 2026 from the company's own websites:
//   https://www.thesachdevgroup.com/business/galaxy-toyota   (Galaxy Toyota description and locations)
//   https://thesachdevgroup.com/                              (group overview, brands, values, contact)
//   https://www.thesachdevgroup.com/our-locations             ("over 30 locations across Delhi NCR")

export const company = {
  name: "Galaxy Toyota",
  group: "The Sachdev Group",
  tagline: "Build your career with Galaxy Toyota",
  intro:
    "Galaxy Toyota is a trusted, authorised Toyota dealership in Delhi, part of The Sachdev Group, one of the largest dealers of Toyota and Hyundai cars in Delhi NCR.",
  about: [
    "Galaxy Toyota brings the full range of the latest Toyota cars to customers across Delhi, backed by authorised after-sales service, genuine parts and customer support at every step.",
    "As part of The Sachdev Group, which has been providing complete automotive solutions for decades, we work alongside sister businesses in new and used car sales, multi-brand servicing and more, across over 30 locations in Delhi NCR.",
  ],
  stats: [
    { value: "30+", label: "Group locations across Delhi NCR" },
    { value: "11", label: "Galaxy Toyota showrooms" },
    { value: "4 + 1", label: "Service centres and a body shop" },
    { value: "7", label: "Businesses in The Sachdev Group" },
  ],
  values: [
    { title: "Reliability & transparency", text: "Clear, honest dealings with every customer and colleague." },
    { title: "Authorised service", text: "Toyota-authorised servicing and genuine parts, done properly." },
    { title: "Authorised dealership", text: "The full Toyota range, sold the way Toyota expects." },
    { title: "Customer first", text: "Every role, from sales floor to workshop, is about the customer." },
  ],
  /** Kinds of work people do across the dealership (for "Where you could work"). */
  teams: [
    { title: "Sales & customer experience", text: "Help customers find the right Toyota and look after them from enquiry to delivery." },
    { title: "Service & workshop", text: "Keep Toyotas running at our authorised service centres and body shop." },
    { title: "Digital, marketing & technology", text: "Websites, campaigns, CRM and the tools that power the dealership." },
    { title: "Finance, insurance & operations", text: "Car finance, insurance, accounts and the operations that keep every site running." },
  ],
  locations: {
    showrooms: ["Moti Nagar", "Shalimar Bagh", "Lajpat Nagar", "Dwarka", "Chhattarpur", "Narela", "Najafgarh", "Okhla", "Rajapuri", "Mundka", "Gokulpuri"],
    serviceCentres: ["Okhla", "Azadpur", "Moti Nagar", "Narela"],
    bodyShops: ["Moti Nagar"],
  },
  groupBrands: ["Galaxy Toyota", "Hans Hyundai", "Harpreet Ford", "Auto Car Repair", "TSG Auction Mart", "TSG Used Cars", "AMS Dry Ice"],
  headOffice: "69, TSG Complex, Moti Nagar, New Delhi",
  contact: { email: "info@thesachdevgroup.com", phone: "+91 95996 72680" },
  links: [
    { label: "galaxytoyota.in", href: "https://www.galaxytoyota.in" },
    { label: "thesachdevgroup.com", href: "https://www.thesachdevgroup.com" },
  ],
};
