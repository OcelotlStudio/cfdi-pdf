import {
    clavesUnidadesCatalog,
    formasPagoCatalog,
    impuestosCatalog,
    metodosPagoCatalog,
    monedasCatalog,
    regimenesFiscalesCatalog,
    tiposComprobantesCatalog,
    tiposRelacionesCatalog,
    usosCfdiCatalog,
} from '../catalogs';
import { toCurrency } from '../utils/toCurrency';
import { formatCurrency, breakEveryNCharacters } from '../utils/helper';
import { exists, existsValue } from '../utils/check';
import { Cfdi, ComplementoPago, Concepto, DoctoRelacionado, Receptor } from '../parser/dataToCfdi';
import { TDocumentDefinitions } from 'pdfmake/interfaces';

export interface Options {
    text?: string;
    image?: string;
    address?: string;
    cadenaOriginal?: string;
}

const generateImpuestos = (concepto: Concepto) => {
    const arr = [];
    if (concepto.traslados.length > 0) {
        arr.push('Traslados');
        const content = concepto.traslados.map((traslado) => {
            return [
                impuestosCatalog[traslado.impuesto]
                    ? `${traslado.impuesto} - ${impuestosCatalog[traslado.impuesto]}`
                    : '',
                traslado.tipoFactor == 'Exento' ? 'EXENTO' : `${formatCurrency(traslado.importe)}`,
            ];
        });
        arr.push({
            table: {
                body: content,
            },
            layout: 'noBorders',
        });
    }
    if (concepto.retenciones.length > 0) {
        arr.push('Retenciones');
        const content = concepto.retenciones.map((retencion) => {
            return [
                impuestosCatalog[retencion.impuesto]
                    ? `${retencion.impuesto} - ${impuestosCatalog[retencion.impuesto]}`
                    : '',
                `${formatCurrency(retencion.importe)}`,
            ];
        });
        arr.push({
            table: {
                body: content,
            },
            layout: 'noBorders',
        });
    }
    return arr;
};

const generateConceptsTable = (conceptos: Array<Concepto>) => {
    const arr: Array<any> = conceptos.map((concepto: Concepto) => [
        concepto.clave,
        concepto.cantidad,
        concepto.claveUnidad,
        clavesUnidadesCatalog[concepto.claveUnidad],
        concepto.descripcion,
        `${formatCurrency(concepto.valorUnitario)}`,
        `${formatCurrency(concepto.descuento)}`,
        {
            colSpan: 2,
            stack: generateImpuestos(concepto),
        },
        '',
        `${formatCurrency(concepto.importe)}`,
    ]);
    arr.unshift([
        'ClaveProdServ',
        'Cant',
        'Clave Unidad',
        'Unidad',
        'Descripci??n',
        'Valor Unitario',
        'Descuento',
        {
            colSpan: 2,
            text: 'Impuesto',
        },
        '',
        'Importe',
    ]);
    arr.unshift([
        {
            text: 'PARTIDAS DEL COMPROBANTE',
            style: 'tableHeader',
            colSpan: 10,
            alignment: 'center',
        },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
    ]);
    return arr;
};

const generateRelatedDocs = (docs: Array<DoctoRelacionado>) => {
    const arr: Array<any> = docs.map((doc: DoctoRelacionado) => [
        doc.uuid,
        doc.metodoPago,
        doc.moneda,
        doc.tipoCambio,
        doc.numParcialidad,
        `${formatCurrency(doc.saldoAnterior)}`,
        `${formatCurrency(doc.importePagado)}`,
        `${formatCurrency(doc.saldoInsoluto)}`,
    ]);
    arr.unshift([
        'UUID',
        'M??todo de Pago',
        'Moneda',
        'Tipo de Cambio',
        'Num. Parcialidad',
        'Importe Saldo Anterior',
        'Importe Pagado',
        'Importe Saldo Insoluto',
    ]);
    arr.unshift([
        {
            text: 'DOCUMENTOS RELACIONADOS',
            style: 'tableHeader',
            colSpan: 8,
            alignment: 'center',
        },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
    ]);
    return arr;
};

const generatePayments = (pagos: Array<ComplementoPago>) => {
    const arr = pagos.map((pago: ComplementoPago) => [
        {
            style: 'tableContent',
            table: {
                widths: [95, '*', 95, '*'],
                body: [
                    [
                        {
                            text: 'INFORMACI??N DE PAGO',
                            style: 'tableHeader',
                            colSpan: 4,
                            alignment: 'center',
                        },
                        {},
                        {},
                        {},
                    ],
                    [
                        'FECHA:',
                        pago.fecha,
                        'FORMA PAGO:',
                        formasPagoCatalog[pago.formaPago]
                            ? `${pago.formaPago} - ${formasPagoCatalog[pago.formaPago]}`
                            : '',
                    ],
                    [
                        'MONEDA:',
                        monedasCatalog[pago.moneda] ? `${pago.moneda} - ${monedasCatalog[pago.moneda]}` : '',
                        'MONTO:',
                        `${formatCurrency(pago.monto)}`,
                    ],
                    pago.tipoCambio ? ['TIPO DE CAMBIO:', pago.tipoCambio, '', ''] : ['', '', '', ''],
                ],
            },
            layout: 'lightHorizontalLines',
        },
        '\n',
        {
            style: 'tableList',
            table: {
                widths: ['*', 'auto', 'auto', 30, 20, 'auto', 'auto', 'auto'],
                body: generateRelatedDocs(pago.doctoRelacionados),
            },
            layout: {
                fillColor(i: number) {
                    return i % 2 !== 0 ? '#CCCCCC' : null;
                },
            },
        },
        '\n',
    ]);
    return [].concat.apply([], arr);
};

const generateQrCode = (json: Cfdi) => {
    const template =
        'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id={id}&re={re}&rr={rr}&tt={tt}&fe={fe}';
    const qrCode = template
        .replace('{id}', json.timbreFiscalDigital.uuid)
        .replace('{re}', json.emisor.rfc)
        .replace('{rr}', json.receptor.rfc)
        .replace('{tt}', json.total)
        .replace(
            '{fe}',
            json.timbreFiscalDigital.selloCFD.substring(
                json.timbreFiscalDigital.selloCFD.length - 8,
                json.timbreFiscalDigital.selloCFD.length,
            ),
        );
    return qrCode;
};

const generateStampTable = (json: Cfdi) => {
    const arr = [];
    if (json.timbreFiscalDigital) {
        const fechaHoraCertificacion = json.timbreFiscalDigital.fechaTimbrado;
        arr.push(
            [
                {
                    colSpan: 1,
                    rowSpan: 8,
                    qr: generateQrCode(json),
                    fit: 140,
                },
                '',
                '',
            ],
            ['', 'NUMERO SERIE CERTIFICADO SAT', exists(json.timbreFiscalDigital.noCertificadoSAT)],
            ['', 'NUMERO SERIE CERTIFICADO EMISOR', exists(json.noCertificado)],
            ['', 'FECHA HORA CERTIFICACION', fechaHoraCertificacion],
            ['', 'FOLIO FISCAL UUID', exists(json.timbreFiscalDigital.uuid)],
            ['', 'SELLO DIGITAL', breakEveryNCharacters(exists(json.timbreFiscalDigital.selloCFD), 86)],
            ['', 'SELLO DEL SAT', breakEveryNCharacters(exists(json.timbreFiscalDigital.selloSAT), 86)],
        );
    }
    arr.push(['', 'CADENA ORIGINAL CC:', { text: breakEveryNCharacters(json.cadenaOriginalCC, 86) }]);
    return arr;
};

const generateAddress = (receptor: Receptor, address?: string) => {
    const arr = [];
    const addressArray = [];
    if (address) {
        addressArray.push('DOMICILIO:', address);
    }
    addressArray.push('USO CFDI:', {
        colSpan: address ? 1 : 3,
        text: usosCfdiCatalog[receptor.usoCFDI] ? `${receptor.usoCFDI} - ${usosCfdiCatalog[receptor.usoCFDI]}` : '',
    });
    arr.push(addressArray);
    if (receptor.residenciaFiscal && receptor.numRegIdTrib) {
        arr.push([
            'RESIDENCIA FISCAL:',
            exists(receptor.residenciaFiscal),
            'NUMERO ID TRIB.:',
            exists(receptor.numRegIdTrib),
        ]);
    }
    return arr;
};

// generate content array used in PDFMake
const generateContent = async (json: Cfdi, logo?: string, text?: string, address?: string) => {
    let content = [];
    // this block contains the logo image and general information
    const header: any = {
        alignment: 'center',
        style: 'tableContent',
        table: {
            widths: ['auto', 'auto', 'auto'],
            fontSize: 9,
            body: [
                ['', 'SERIE:', json.serie],
                ['', 'FOLIO:', json.folio],
                ['', 'FECHA:', json.fecha],
                ['', 'EXPEDICION:', json.lugar],
                [
                    '',
                    'COMPROBANTE:',
                    tiposComprobantesCatalog[json.tipoDeComprobante]
                        ? `${json.tipoDeComprobante} - ${tiposComprobantesCatalog[json.tipoDeComprobante]}`
                        : '',
                ],
            ],
        },
        layout: 'lightHorizontalLines',
    };
    if (logo) {
        header.table.body[0][0] = { rowSpan: 5, image: logo, fit: [260, 260] };
        header.table.widths = ['*', 'auto', 'auto'];
    }
    content.push(header);
    // space
    content.push('\n');
    // this block contains info. about "emisor" object
    content.push({
        style: 'tableContent',
        table: {
            widths: ['auto', '*', 'auto', 'auto'],
            body: [
                [
                    {
                        text: 'EMISOR',
                        style: 'tableHeader',
                        colSpan: 4,
                        alignment: 'center',
                    },
                    {},
                    {},
                    {},
                ],
                ['NOMBRE:', exists(json.emisor.nombre), 'RFC:', exists(json.emisor.rfc)],
                [
                    'REGIMEN FISCAL:',
                    {
                        colSpan: 3,
                        text: regimenesFiscalesCatalog[json.emisor.regimenFiscal]
                            ? `${json.emisor.regimenFiscal} - ${regimenesFiscalesCatalog[json.emisor.regimenFiscal]}`
                            : '',
                    },
                    '',
                ],
            ],
        },
        layout: 'lightHorizontalLines',
    });
    // space
    content.push('\n');
    // this block contains info. about "receptor" object
    content.push({
        style: 'tableContent',
        table: {
            widths: ['auto', '*', 'auto', 'auto'],
            body: [
                [
                    {
                        text: 'RECEPTOR',
                        style: 'tableHeader',
                        colSpan: 4,
                        alignment: 'center',
                    },
                    {},
                    {},
                    {},
                ],
                ['NOMBRE:', exists(json.receptor.nombre), 'RFC:', exists(json.receptor.rfc)],
                ...generateAddress(json.receptor, address),
            ],
        },
        layout: 'lightHorizontalLines',
    });
    // space
    content.push('\n');
    // check type of invoice
    if (json.tipoDeComprobante.toUpperCase() === 'I' || json.tipoDeComprobante.toUpperCase() === 'E') {
        // this block contains general info. about the invoice
        content.push({
            style: 'tableContent',
            table: {
                widths: [95, '*', 95, '*'],
                body: [
                    [
                        {
                            text: 'DATOS GENERALES DEL COMPROBANTE',
                            style: 'tableHeader',
                            colSpan: 4,
                            alignment: 'center',
                        },
                        {},
                        {},
                        {},
                    ],
                    [
                        'MONEDA:',
                        monedasCatalog[json.moneda] ? `${json.moneda} - ${monedasCatalog[json.moneda]}` : '',
                        'FORMA PAGO:',
                        formasPagoCatalog[json.formaPago]
                            ? `${json.formaPago} - ${formasPagoCatalog[json.formaPago]}`
                            : '',
                    ],
                    ['TIPO DE CAMBIO:', json.tipoCambio, 'CONDICIONES DE PAGO:', json.condicionesDePago],
                    [
                        'CLAVE CONFIRMACION:',
                        json.confirmacion,
                        'METODO DE PAGO:',
                        metodosPagoCatalog[json.metodoPago]
                            ? `${json.metodoPago} - ${metodosPagoCatalog[json.metodoPago]}`
                            : '',
                    ],
                ],
            },
            layout: 'lightHorizontalLines',
        });
        // space
        content.push('\n');
    }
    // this block contains the concepts of the invoice
    content.push({
        style: 'tableList',
        table: {
            widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: generateConceptsTable(json.conceptos),
        },
        layout: {
            fillColor(i: number) {
                return i % 2 !== 0 ? '#CCCCCC' : null;
            },
        },
    });
    // space
    content.push('\n');
    // check type of invoice
    if (json.tipoDeComprobante.toUpperCase() === 'I' || json.tipoDeComprobante.toUpperCase() === 'E') {
        // this block contains currency related info.
        content.push({
            style: 'tableContent',
            table: {
                widths: ['auto', '*', 'auto', '*'],
                body: [
                    [
                        {
                            text: 'CFDI RELACIONADO',
                            style: 'tableHeader',
                            colSpan: 4,
                            alignment: 'center',
                        },
                        {},
                        {},
                        {},
                    ],
                    [
                        'TIPO RELACION:',
                        tiposRelacionesCatalog[json.cfdiRelacionado ? json.cfdiRelacionado.tipoRelacion : '']
                            ? `${json.cfdiRelacionado.tipoRelacion} - ${
                                  tiposRelacionesCatalog[json.cfdiRelacionado.tipoRelacion]
                              }`
                            : '',
                        'CFDI RELACIONADO:',
                        json.cfdiRelacionado ? exists(json.cfdiRelacionado.uuid) : '',
                    ],
                    ['SUBTOTAL:', `${formatCurrency(json.subTotal)}`, 'TOTAL:', `${formatCurrency(json.total)}`],
                    [
                        'DESCUENTO:',
                        `${formatCurrency(json.descuento)}`,
                        { text: 'IMPORTE CON LETRA:' },
                        { text: await toCurrency(parseFloat(json.total), json.moneda) },
                    ],
                    [
                        'TOTAL IMP. TRASLADADOS:',
                        `${formatCurrency(existsValue(json.totalImpuestosTrasladados))}`,
                        'TOTAL IMP. RETENIDOS:',
                        `${formatCurrency(existsValue(json.totalImpuestosRetenidos))}`,
                    ],
                ],
            },
            layout: 'lightHorizontalLines',
        });
        // space
        content.push('\n');
    }
    // check type of invoice
    if (json.tipoDeComprobante.toUpperCase() === 'P') {
        // this block contains info. about payment
        content = content.concat(generatePayments(json.pagos));
    }
    if (text) {
        // observations
        content.push({
            style: 'tableContent',
            table: {
                widths: ['*'],
                body: [[{ text: 'OBSERVACIONES', style: 'tableHeader' }], [text]],
            },
            layout: 'lightHorizontalLines',
        });
        // space
        content.push('\n');
    }
    // this block contains info. about the stamp
    content.push({
        style: 'tableSat',
        table: {
            widths: ['auto', 'auto', '*'],
            body: generateStampTable(json),
        },
        layout: 'lightHorizontalLines',
    });
    return content;
};

/**
 * Receives a json and returns a pdf content object for pdfmake
 * @param {Cfdi} json result json from using parseData function
 */
export const generatePdfContent = async (json: Cfdi, options: Options) => {
    // look for a base64 image
    // eslint-disable-next-line
    const logo = options.image;
    if (options.cadenaOriginal) json.cadenaOriginalCC = options.cadenaOriginal;
    const dd: TDocumentDefinitions = {
        content: await generateContent(json, logo, options.text, options.address),
        styles: {
            tableHeader: {
                bold: true,
                fontSize: 10,
                color: 'black',
            },
            tableContent: {
                fontSize: 8,
                color: 'black',
                alignment: 'left',
            },
            tableList: {
                fontSize: 7,
                color: 'black',
                alignment: 'center',
            },
            tableSat: {
                fontSize: 5,
                color: 'black',
                alignment: 'left',
            },
        },
        defaultStyle: {
            // alignment: 'justify'
        },
        footer() {
            return {
                style: 'tableContent',
                table: {
                    widths: ['auto', '*', 'auto', 'auto'],
                    body: [
                        [
                            {
                                text: 'Este documento es una representaci??n impresa de un CFDI',
                                style: 'tableList',
                                colSpan: 4,
                                alignment: 'center',
                            },
                            {},
                            {},
                            {},
                        ],
                    ],
                },
                layout: 'lightHorizontalLines',
            };
        },
    };
    return dd;
};
