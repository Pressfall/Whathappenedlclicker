// Carousel configuration for each product
const carousels = {
    shirt: {
        images: [
            "merchImages/whshirt1.jpg",
            "merchImages/whshirt2.jpg",
            "merchImages/whshirt3.jpg",
            "merchImages/whshirt4.jpg",
        ],
        carouselEl: document.getElementById("carousel"),
        imgEl: document.getElementById("carousel-img"),
        index: 0,
        interval: null,
        pendingTimeout: null
    },
    sweatshirt: {
        images: [
            "merchImages/WHsweathshirt1.jpg",
            "merchImages/WHsweatshirt2.jpg",
            "merchImages/WHsweatshirt3.jpg",
            "merchImages/WHsweatshirt4.jpg",
            "merchImages/WHsweatshirt5.jpg",
            "merchImages/WHsweatshirt6.jpg",
        ],
        carouselEl: document.getElementById("carousel-sweatshirt"),
        imgEl: document.getElementById("carousel-sweatshirt-img"),
        index: 0,
        interval: null,
        pendingTimeout: null
    },
    phonecase: {
        images: [
            "merchImages/whphonecase1.jpg",
            "merchImages/whphonecase2.jpg",
            "merchImages/whphonecase3.jpg",
        ],
        carouselEl: document.getElementById("carousel-phonecase"),
        imgEl: document.getElementById("carousel-phonecase-img"),
        index: 0,
        interval: null,
        pendingTimeout: null
    },
    deskmat: {
        images: [
            "merchImages/whdeskmat1.jpg",
            "merchImages/whdeskmat2.jpg",
            "merchImages/whdeskmat3.jpg",
        ],
        carouselEl: document.getElementById("carousel-deskmat"),
        imgEl: document.getElementById("carousel-deskmat-img"),
        index: 0,
        interval: null,
        pendingTimeout: null
    }
    ,
    cup: {
        images: [
            "merchImages/WHcup1.jpg",
            "merchImages/WHcup2.jpg",
            "merchImages/WHcup3.jpg",
            "merchImages/WHcup4.jpg",
        ],
        carouselEl: document.getElementById("carousel-cup"),
        imgEl: document.getElementById("carousel-cup-img"),
        index: 0,
        interval: null,
        pendingTimeout: null
    }
    ,
    poster: {
        images: [
            "merchImages/WHposter1.jpg",
            "merchImages/WHposter2.jpg",
            "merchImages/WHposter3.jpg",
            "merchImages/WHposter4.jpg",
        ],
        carouselEl: document.getElementById("carousel-poster"),
        imgEl: document.getElementById("carousel-poster-img"),
        index: 0,
        interval: null,
        pendingTimeout: null
    }
};

// Generic carousel controller
function setupCarousel(carouselConfig) {
    let isFirstLoad = true;
    function startCarousel() {
        return setInterval(() => {
            // Skip fade-out on first load to show initial image properly
            if (!isFirstLoad) {
                carouselConfig.imgEl.style.opacity = 0; // Start fade-out
            }
            isFirstLoad = false;
            
            carouselConfig.pendingTimeout = setTimeout(() => {
                carouselConfig.index = (carouselConfig.index + 1) % carouselConfig.images.length;
                carouselConfig.imgEl.src = carouselConfig.images[carouselConfig.index];
                carouselConfig.imgEl.style.opacity = 1; // Start fade-in
            }, 500);
        }, 4000);
    }

    carouselConfig.carouselEl.addEventListener("mouseenter", () => {
        if (carouselConfig.interval) clearInterval(carouselConfig.interval);
        if (carouselConfig.pendingTimeout) clearTimeout(carouselConfig.pendingTimeout);
        carouselConfig.interval = null;
        carouselConfig.pendingTimeout = null;
        // Ensure image is visible when pausing carousel during transition
        carouselConfig.imgEl.style.opacity = 1;
    });

    carouselConfig.carouselEl.addEventListener("mouseleave", () => {
        carouselConfig.interval = startCarousel();
    });

    // Start the carousel initially
    carouselConfig.interval = startCarousel();
}

// Initialize all carousels
setupCarousel(carousels.shirt);
setupCarousel(carousels.sweatshirt);
setupCarousel(carousels.phonecase);
setupCarousel(carousels.deskmat);
setupCarousel(carousels.cup);
setupCarousel(carousels.poster);