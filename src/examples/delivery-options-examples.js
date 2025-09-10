/**
 * Examples of how to create posts with delivery options
 * These are examples for frontend integration
 */

// Example 1: Product Post with ONLINE delivery (no location required)
const productPostOnline = {
    postType: "photo",
    caption: "Check out our amazing new product!",
    description: "Available for instant download",
    product: {
        name: "Digital Marketing Course",
        description: "Complete digital marketing course with certificates",
        price: 99.99,
        currency: "USD",
        category: "Education",
        deliveryOptions: "online", // No location required
        link: "https://mystore.com/digital-course"
    }
    // No location field needed for online products
};

// Example 2: Product Post with OFFLINE delivery (location mandatory)
const productPostOffline = {
    postType: "photo", 
    caption: "Fresh organic vegetables available!",
    description: "Farm-fresh produce delivered to your door",
    product: {
        name: "Organic Vegetable Box",
        description: "Weekly box of seasonal organic vegetables",
        price: 45.00,
        currency: "USD",
        category: "Food",
        deliveryOptions: "offline", // Location mandatory
        location: {
            name: "Green Farm Market",
            address: "123 Farm Road, Springfield, IL 62701",
            city: "Springfield",
            state: "Illinois", 
            country: "USA"
            // coordinates will be auto-resolved
        },
        link: "https://greenfarm.com/veggie-box"
    }
};

// Example 3: Service Post with BOTH delivery options (location mandatory)
const servicePostBoth = {
    postType: "photo",
    caption: "Web development services available!",
    description: "Remote and on-site web development",
    service: {
        name: "Custom Website Development",
        description: "Full-stack web development services",
        price: 2500.00,
        currency: "USD",
        category: "Technology",
        deliveryOptions: "both", // Location mandatory for offline component
        duration: 30, // days
        location: {
            address: "456 Tech Center, Austin, TX 78701",
            city: "Austin",
            state: "Texas",
            country: "USA"
        },
        link: "https://mywebdev.com/services"
    }
};

// Example 4: Business Post with OFFLINE presence (location mandatory)
const businessPostOffline = {
    postType: "photo",
    caption: "Visit our new coffee shop!",
    description: "Best coffee in downtown",
    business: {
        businessName: "Joe's Coffee House",
        businessType: "Coffee Shop",
        description: "Artisanal coffee and pastries",
        category: "Food & Beverage",
        deliveryOptions: "offline", // Physical location only
        location: {
            name: "Joe's Coffee House",
            address: "789 Main Street, Portland, OR 97205",
            city: "Portland",
            state: "Oregon",
            country: "USA"
        },
        hours: [
            { day: "Monday", openTime: "07:00", closeTime: "19:00", isClosed: false },
            { day: "Tuesday", openTime: "07:00", closeTime: "19:00", isClosed: false },
            // ... other days
        ],
        link: "https://joescoffee.com"
    }
};

// Example 5: INVALID - Offline without location (will throw error)
const invalidOfflinePost = {
    postType: "photo",
    caption: "Invalid post example",
    product: {
        name: "Local Service",
        deliveryOptions: "offline"
        // Missing location - this will cause validation error
    }
};

/**
 * API Request Examples for Frontend
 */

// Example API call with FormData (including media files)
const createProductPostAPI = async (productData, mediaFiles) => {
    const formData = new FormData();
    
    // Add basic post data
    formData.append('postType', productData.postType);
    formData.append('caption', productData.caption);
    formData.append('description', productData.description);
    
    // Add product data as JSON string
    formData.append('product', JSON.stringify(productData.product));
    
    // Add media files
    mediaFiles.forEach((file, index) => {
        formData.append('image', file); // or 'video' depending on type
    });
    
    try {
        const response = await fetch('/api/v1/posts/create/product', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            body: formData
        });
        
        return await response.json();
    } catch (error) {
        console.error('Failed to create product post:', error);
        throw error;
    }
};

/**
 * Frontend Validation Logic
 */
const validateDeliveryOptions = (postData) => {
    const { deliveryOptions, location } = postData;
    
    if (!deliveryOptions) {
        return { isValid: false, error: "Delivery options are required" };
    }
    
    if (!['online', 'offline', 'both'].includes(deliveryOptions)) {
        return { isValid: false, error: "Invalid delivery option" };
    }
    
    // Check location requirement for offline/both
    if ((deliveryOptions === 'offline' || deliveryOptions === 'both')) {
        if (!location) {
            return { isValid: false, error: "Location is required for offline/both delivery options" };
        }
        
        if (!location.name && !location.address) {
            return { isValid: false, error: "Location name or address is required" };
        }
    }
    
    return { isValid: true };
};

/**
 * React Component Example
 */
const DeliveryOptionsForm = () => {
    const [deliveryOption, setDeliveryOption] = useState('online');
    const [location, setLocation] = useState({});
    const [showLocation, setShowLocation] = useState(false);
    
    useEffect(() => {
        setShowLocation(deliveryOption === 'offline' || deliveryOption === 'both');
    }, [deliveryOption]);
    
    return (
        <div>
            <div>
                <label>Delivery Options:</label>
                <select 
                    value={deliveryOption} 
                    onChange={(e) => setDeliveryOption(e.target.value)}
                >
                    <option value="online">Online Only</option>
                    <option value="offline">Physical Location Only</option>
                    <option value="both">Both Online & Physical</option>
                </select>
            </div>
            
            {showLocation && (
                <div className="location-fields">
                    <h4>Location Details (Required)</h4>
                    <input
                        type="text"
                        placeholder="Business/Service Name"
                        value={location.name || ''}
                        onChange={(e) => setLocation({...location, name: e.target.value})}
                    />
                    <input
                        type="text"
                        placeholder="Address"
                        value={location.address || ''}
                        onChange={(e) => setLocation({...location, address: e.target.value})}
                        required
                    />
                    <input
                        type="text"
                        placeholder="City"
                        value={location.city || ''}
                        onChange={(e) => setLocation({...location, city: e.target.value})}
                    />
                    <input
                        type="text"
                        placeholder="State"
                        value={location.state || ''}
                        onChange={(e) => setLocation({...location, state: e.target.value})}
                    />
                </div>
            )}
        </div>
    );
};

export {
    productPostOnline,
    productPostOffline,
    servicePostBoth,
    businessPostOffline,
    invalidOfflinePost,
    createProductPostAPI,
    validateDeliveryOptions,
    DeliveryOptionsForm
};