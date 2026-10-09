package com.bucks.app.data

object Seed {
    val SKILLS = listOf("Plumber","Electrician","Doctor","Gym trainer","Photographer","Software developer","Carpenter","Painter","Tutor","Yoga instructor","Lawyer","Accountant","Mechanic","AC technician","Beautician","Driver (hire)","Cook","Tailor","Interior designer","Nurse","Physiotherapist","Videographer","DJ","Event planner","Gardener","Pest control","Mover & packer","Architect","Data analyst","UX designer")
    val BIZ_CATS = listOf("Grocery","Restaurant","Vegetables","Bakery","Pharmacy","Electronics","Furniture","Clothing","IT firm","Design agency","MNC","Salon","Hardware","Stationery","Mobile repair","Pet store")
    val PLACES = listOf("Koramangala, Bengaluru","Nexus Mall, Koramangala","Jayanagar 4th block","MG Road","Indiranagar 100 ft Rd","Whitefield, ITPL","Majestic bus stand","Kempegowda airport")
    val PEOPLE = listOf("Shafeeq","Anitha","Karthik","Priya","Mohan","Senthil","Rekha","Vinod","Divya","Sudha")
    const val ME_X = 50f; const val ME_Y = 52f

    private fun c(w: String, t: String, v: Int) = Comment(w, t, v, voterId = "u-" + w.lowercase().replace(" ", "-"), verified = w.length % 2 == 0, txnId = "seed-" + w.hashCode().toString(16))
    val providers: List<Provider> = listOf(
        Provider("p1", ProviderType.BUSINESS, "Restaurant", "Hot Griddle", listOf("biriyani","biryani","food","chicken","restaurant","lunch","dinner"), 60f, 40f, 1.2, 212, 9, Scope.LOCAL, "Family-run biriyani house since 2014.", listOf(Item("Chicken biriyani",220,"Non-veg","Serves 1","Main course"),Item("Mutton biriyani",290,"Non-veg","Serves 1","Main course"),Item("Veg biriyani",160,"Veg","Serves 1","Main course"),Item("Raita",40,"Veg","150 ml","Sides"),Item("Gulab jamun",60,"Veg","2 pieces","Desserts")), null, listOf(c("Anitha","Best biriyani near Jayanagar, fast delivery",1),c("Sam","Slightly oily but tasty",1),c("Karthik","Late by 40 min once",-1))),
        Provider("p2", ProviderType.BUSINESS, "Restaurant", "Nawab Dum", listOf("biriyani","biryani","food","restaurant","kebab"), 32f, 62f, 2.4, 98, 21, Scope.LOCAL, "Hyderabadi dum biriyani.", listOf(Item("Hyderabadi biriyani",250,"Non-veg","Serves 1","Main course"),Item("Seekh kebab",180,"Non-veg","4 pieces","Starters")), null, listOf(c("Priya","Authentic taste",1),c("Dev","Portion got smaller",-1))),
        Provider("p3", ProviderType.BUSINESS, "Grocery", "Sri Lakshmi Stores", listOf("sugar","rice","grocery","dal","oil","atta","milk"), 44f, 30f, 0.6, 340, 6, Scope.LOCAL, "Neighbourhood grocery. Free delivery within 2 km.", listOf(Item("Sugar",46,"Staples","1 kg","Staples"),Item("Sona masoori rice",320,"Staples","5 kg","Staples"),Item("Toor dal",150,"Staples","1 kg","Staples"),Item("Sunflower oil",135,"Oils","1 L","Oils"),Item("Nandini milk",27,"Dairy","500 ml","Dairy"),Item("Curd",30,"Dairy","500 g","Dairy")), null, listOf(c("Meena","Same price as MRP, delivers in 20 min",1),c("Arun","Reliable, never a wrong item",1))),
        Provider("p4", ProviderType.BUSINESS, "Grocery", "BigBasket", listOf("sugar","rice","grocery","dal","oil","atta","milk"), 80f, 20f, 9.5, 5100, 800, Scope.GLOBAL, "Online grocery, next-day delivery.", listOf(Item("Sugar",44,"Staples","1 kg","Staples"),Item("Rice",310,"Staples","5 kg","Staples")), null, listOf(c("Raj","Cheap but slow",1),c("Nisha","Wrong item twice",-1))),
        Provider("p5", ProviderType.BUSINESS, "Vegetables", "Manju Veg Cart", listOf("vegetables","tomato","onion","potato","veg","spinach"), 52f, 66f, 0.4, 76, 2, Scope.LOCAL, "Farm-fresh vegetables, cart at 5th block.", listOf(Item("Tomato",32,"Vegetables","1 kg","Fresh"),Item("Onion",38,"Vegetables","1 kg","Fresh"),Item("Spinach",15,"Greens","1 bunch","Fresh")), null, listOf(c("Sudha","Fresh every morning",1))),
        Provider("p6", ProviderType.SKILL, "Plumber", "Suresh M", listOf("plumber","leak","tap","pipe","bathroom"), 28f, 40f, 1.8, 143, 4, Scope.LOCAL, "12 yrs experience. Leaks, fittings, water heaters.", emptyList(), "₹300 visit + parts", listOf(c("Vinod","Fixed a hidden leak in 30 min",1),c("Rekha","Came on time, fair price",1))),
        Provider("p7", ProviderType.SKILL, "Plumber", "Aqua Fix (Naveen)", listOf("plumber","pipe","tank","motor"), 70f, 70f, 3.1, 31, 12, Scope.LOCAL, "Motors, tanks, pipelines.", emptyList(), "₹250 visit", listOf(c("Gopal","Cheap but rescheduled twice",-1),c("Latha","Good with motors",1))),
        Provider("p8", ProviderType.SKILL, "Doctor", "Dr. Kavya Rao", listOf("doctor","fever","clinic","physician","general"), 58f, 26f, 1.0, 410, 7, Scope.LOCAL, "MBBS, MD General Medicine. Clinic 9–1, 5–8.", emptyList(), "₹400 consult", listOf(c("Hari","Listens patiently, explains clearly",1),c("Divya","Wait time 45 min",-1),c("Mohan","Great with kids",1))),
        Provider("p9", ProviderType.SKILL, "Electrician", "Basha Electricals", listOf("electrician","wiring","fan","switch","mcb"), 38f, 22f, 1.5, 88, 3, Scope.LOCAL, "Wiring, fans, inverter install.", emptyList(), "₹200 visit", listOf(c("Ajay","Rewired the whole flat, neat work",1))),
        Provider("p10", ProviderType.SKILL, "Software developer", "Ananya S", listOf("software","developer","app","website","android","kotlin"), 64f, 56f, 2.2, 57, 1, Scope.GLOBAL, "Android + backend. Remote or on-site.", emptyList(), "₹1500/hr", listOf(c("Startup XYZ","Shipped our MVP in 6 weeks",1))),
        Provider("p11", ProviderType.SKILL, "Gym trainer", "Coach Imran", listOf("gym","trainer","fitness","weight","workout"), 22f, 56f, 2.6, 120, 14, Scope.LOCAL, "Strength & conditioning, home visits.", emptyList(), "₹4000/month", listOf(c("Ritu","Lost 6 kg in 3 months",1))),
        Provider("p12", ProviderType.SKILL, "Photographer", "Lens & Light", listOf("photographer","wedding","photo","shoot","portrait"), 76f, 46f, 3.4, 66, 5, Scope.LOCAL, "Weddings, events, portraits.", emptyList(), "₹8000/day", listOf(c("Sneha","Wedding album was beautiful",1))),
        Provider("p13", ProviderType.BUSINESS, "IT firm", "Mikado UX UI", listOf("design","agency","ux","ui","branding","it"), 66f, 36f, 2.0, 5600, 120, Scope.GLOBAL, "Award-winning branding and UX studio.", listOf(Item("UX audit",25000,"Service","2 weeks","Services"),Item("App design sprint",120000,"Service","6 weeks","Services")), null, listOf(c("Fintech Co","World-class, on budget",1))),
        Provider("p14", ProviderType.BUSINESS, "Furniture", "Woodcraft Studio", listOf("furniture","sofa","table","chair","bed","teak"), 24f, 46f, 2.8, 154, 9, Scope.LOCAL, "Solid-wood furniture made in Bengaluru. Custom sizes on request.", listOf(Item("Teak dining table",42000,"Teak","6 seater · 180 × 90 cm","Dining"),Item("Oak bookshelf",14500,"Oak","5 shelves · 180 cm","Living"),Item("Fabric 3-seater sofa",38000,"Fabric","Grey · removable covers","Living"),Item("Queen bed frame",29000,"Sheesham","Storage drawers","Bedroom")), null, listOf(c("Nithya","Table arrived in 10 days, finish is superb",1),c("Rahul","Delivery crew scratched a wall",-1))),
        Provider("p15", ProviderType.BUSINESS, "Electronics", "Volt Electronics", listOf("electronics","phone","laptop","headphones","tv","charger"), 72f, 58f, 1.9, 522, 31, Scope.LOCAL, "Phones, laptops and accessories with same-day setup at home.", listOf(Item("Wireless earbuds",2999,"Boat","1-year warranty · 30 h battery","Audio"),Item("65 W GaN charger",1799,"Anker","Dual port","Accessories"),Item("14-inch laptop",54990,"Lenovo","Ryzen 5 · 16 GB · 512 GB · 2-year warranty","Computers"),Item("43-inch 4K TV",28990,"Mi","3-year panel warranty","TV")), null, listOf(c("Ganesh","Set up the TV the same evening",1),c("Farah","Price matched online, honest advice",1))),
    )
    val drivers: List<Driver> = listOf(
        Driver("d1","Jagadish D",VehicleKind.BIKE,"KA05 AB 1234","Honda Activa",42f,44f,0.8,322,6,true),
        Driver("d2","Ramesh B",VehicleKind.AUTO,"KA01 CD 5678","Bajaj RE",60f,60f,1.3,540,31,true),
        Driver("d3","Farida K",VehicleKind.CAB,"KA03 EF 9012","Maruti Dzire",36f,64f,2.1,210,4,true),
        Driver("d4","Sanjay P",VehicleKind.BIKE,"KA51 GH 3456","TVS Jupiter",70f,30f,3.6,44,9,false),
        Driver("d5","Manoj T",VehicleKind.CAB,"KA02 IJ 7890","Toyota Innova",24f,34f,4.2,980,22,true),
    )
    val posts: List<Post> = listOf(
        Post("f1","Shafeeq","2h","Wishing you a joyful and prosperous Diwali! May this festival of lights bring happiness and warmth.",true,null,41,1, listOf("Anu" to "Same to you!")),
        Post("f2","Senthil Devaraj","5h","Hi guys, I have been unemployed for 12 months. Please help by reviewing my resume and share if you know openings.",false,"Senthil_Resume.pdf",128,2, listOf("Mikado UX UI" to "DM us, we are hiring a product designer")),
        Post("f3","Mikado UX UI","1d","We are in search of a graphic designer with illustrative and sketching skills. Check our Jobs tab and share.",false,null,66,4),
        Post("f4","Hot Griddle","1d","Weekend special: mutton biriyani at ₹250. Order through Bucks, no delivery fee within 3 km.",true,null,210,8, listOf("Karthik" to "Ordered, arrived hot")),
    )
    val people: List<Person> = listOf(
        Person("u1","Shafeeq","Jayanagar","Runs a small design studio, posts about local events",88,2,true,0.9),
        Person("u2","Anitha R","Jayanagar 4th block","Home baker, reviews every restaurant she tries",140,5,true,0.4),
        Person("u3","Karthik V","Basavanagudi","Cyclist, knows every mechanic in south Bengaluru",61,3,false,1.6),
        Person("u4","Priya Menon","Koramangala","Product manager, hiring for a fintech",210,8,false,3.2),
        Person("u5","Mohan Das","JP Nagar","Retired teacher, tutors kids in the evenings",95,1,false,2.1),
        Person("u6","Rekha S","Jayanagar","Organises the weekend farmers market",174,6,false,0.7),
    )
    val communities: List<Community> = listOf(
        Community("g1","Jayanagar residents","Local notices, lost & found, recommendations",2340,true),
        Community("g2","South Bengaluru cyclists","Weekend rides and trusted mechanics",610),
        Community("g3","Home cooks & foodies","Reviews, recipes and pop-up food stalls",1820),
        Community("g4","Freelancers Bengaluru","Gigs, clients and rate discussions",970),
        Community("g5","Auto & bike riders","Rider-only group for fares, routes and safety",1250),
    )
    val chats: List<Chat> = listOf(
        Chat("c1","Suresh M","Plumber", listOf(ChatMessage(false,"Hi, I can come tomorrow 10 am. Does that work?"),ChatMessage(true,"Yes, 10 am is fine.")),1,true),
        Chat("c2","Hot Griddle","Restaurant", listOf(ChatMessage(false,"Your order is packed, rider on the way.")),0,true),
        Chat("c3","Ananya S","Software developer", listOf(ChatMessage(true,"Can you help with an Android app?"),ChatMessage(false,"Sure, send me the brief.")),0,false),
    )
}
