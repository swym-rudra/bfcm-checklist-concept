# BFCM Checklist Project

A comprehensive Black Friday Cyber Monday (BFCM) checklist system built with Node.js, featuring automated email templates, PDF generation, and web scraping capabilities.

## 🚀 Features

- **Email Templates**: Pre-built templates for various BFCM scenarios
- **PDF Generation**: Automated PDF creation for marketing materials
- **Web Scraping**: Data collection and analysis tools
- **Server Management**: Express.js server for template serving
- **Image Processing**: Sharp integration for image optimization
- **Browser Automation**: Puppeteer for dynamic content generation

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (version 18 or higher)
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/swym-rudra/bfcm-checklist-concept.git
cd bfcm-checklist-concept
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages listed in `package.json` and `requirements.txt`.

### 3. Environment Setup

Create a `.env` file in the root directory:

```bash
touch .env
```

Add your environment variables (example):

```env
# Google AI API Key (if using generative AI features)
GOOGLE_AI_API_KEY=your_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Add other environment variables as needed
```

## 🚀 Running the Project

### Start the Server

```bash
npm start
```

Or if you prefer to run directly:

```bash
node server.js
```

The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

### Alternative Scripts

```bash
# Run with nodemon for development (auto-restart on file changes)
npm run dev

# Run specific components
node scraper.js
node perp.js
node s2.js
```

## 📁 Project Structure

```
bfcm-checklist-concept/
├── templates/                 # HTML email templates
│   ├── back-in-stock-template.html
│   ├── intro-page.html
│   ├── low-stock.html
│   ├── pos-template.html
│   ├── price-drop-template.html
│   └── wishlist-pos.html
├── pdfs/                     # Generated PDF files
│   ├── back-in-stock.pdf
│   ├── closing-page.pdf
│   ├── intro-page.pdf
│   ├── low-stock.pdf
│   ├── pos-page.pdf
│   ├── price-drop.pdf
│   ├── wishlist-incentive.pdf
│   └── wishlist-reminder.pdf
├── server.js                 # Main Express server
├── scraper.js               # Web scraping utilities
├── perp.js                  # Additional utilities
├── s2.js                    # Secondary scripts
├── text-content.js          # Content management
├── package.json             # Node.js dependencies
├── requirements.txt          # Dependency documentation
└── README.md                # This file
```

## 🔧 Configuration

### Server Configuration

Edit `server.js` to modify:
- Port settings
- Static file serving
- Route configurations
- Middleware settings

### Template Customization

Modify HTML templates in the `templates/` directory:
- Update branding and colors
- Customize content and messaging
- Adjust layout and styling

### PDF Settings

Configure PDF generation in relevant scripts:
- Page size and orientation
- Margins and spacing
- Font settings and styling

## 📧 Email Templates

The project includes several pre-built email templates:

1. **Back-in-Stock**: Notify customers when products become available
2. **Intro Page**: Welcome and introduction emails
3. **Low Stock**: Urgency-driven inventory alerts
4. **POS (Point of Sale)**: Sales and promotional content
5. **Price Drop**: Discount and sale announcements
6. **Wishlist Incentive**: Encourage wishlist engagement

## 🖥️ Web Interface

Access the web interface at `http://localhost:3000` to:
- View and customize templates
- Generate PDFs
- Manage content
- Monitor system status

## 🐛 Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Kill process using port 3000
   lsof -ti:3000 | xargs kill -9
   ```

2. **Dependencies Not Found**
   ```bash
   # Clear npm cache and reinstall
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Permission Errors**
   ```bash
   # Fix file permissions
   chmod +x server.js
   ```

### Debug Mode

Enable debug logging:

```bash
DEBUG=* npm start
```

## 📚 API Documentation

### Server Endpoints

- `GET /` - Main page
- `GET /templates/:name` - Template preview
- `POST /generate-pdf` - PDF generation
- `GET /api/status` - Server status

### Script Usage

```bash
# Web scraping
node scraper.js [url] [options]

# PDF generation
node perp.js [template] [output]

# Utility functions
node s2.js [command] [args]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Check the troubleshooting section above
- Review the code comments for implementation details

## 🔄 Updates

Keep your project updated:

```bash
# Update dependencies
npm update

# Check for outdated packages
npm outdated

# Update to latest versions (use with caution)
npm install -g npm-check-updates
ncu -u
npm install
```

---

**Happy BFCM Campaign Management! 🎉**
